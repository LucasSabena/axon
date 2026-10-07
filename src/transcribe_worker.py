#!/usr/bin/env python3
"""Axon transcription worker.

Started on demand by Axon (one process per engine), loads the ASR model the
first time a job needs it, serves jobs over HTTP on 127.0.0.1 and exits by
itself after --idle seconds without work, so the model never sits in RAM/VRAM
when nobody is using it.

Engines:
  whisper   openai-whisper (system python, CUDA when available)
  parakeet  NVIDIA Parakeet TDT 0.6B v3 via onnx-asr (CPU, 25 languages)
"""
import argparse
import hmac
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import types
import uuid
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ap = argparse.ArgumentParser()
ap.add_argument("--engine", default="whisper", choices=["whisper", "parakeet"])
ap.add_argument("--port", type=int, required=True)
ap.add_argument("--idle", type=int, default=600)
ap.add_argument("--models", default=os.path.expanduser("~/.cache/axon-library/models"))
args = ap.parse_args()

# Axon threads this token through the spawn environment; every endpoint
# requires it as a header (127.0.0.1 is reachable by any local process).
TOKEN = os.environ.get("AXON_ASR_TOKEN", "")
MAX_BODY = 128 * 1024
FFMPEG_TIMEOUT = 30 * 60  # decoding a very long source to wav

PARAKEET_REPO = "istupakov/parakeet-tdt-0.6b-v3-onnx"
PARAKEET_NAME = "nemo-parakeet-tdt-0.6b-v3"

lock = threading.Lock()
jobs = {}
order = []
q = queue.Queue()
state = {"model": None, "name": None, "loading": False, "device": None, "last": time.time(), "busy": None}


class Cancelled(Exception):
    pass


def touch():
    state["last"] = time.time()


# ---------- Model loading ----------

def free_model():
    state["model"] = None
    state["name"] = None
    try:
        import gc
        gc.collect()
        if args.engine == "whisper":
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
    except Exception:
        pass


def load(name, job):
    if state["model"] is not None and state["name"] == name:
        return state["model"]
    free_model()
    state["loading"] = True
    job["stage"] = "loading"
    try:
        if args.engine == "whisper":
            import torch
            import whisper
            dev = "cuda" if torch.cuda.is_available() else "cpu"
            try:
                m = whisper.load_model(name, device=dev)
            except RuntimeError as e:
                # Out of VRAM (or a broken driver) — CPU still works, just slower.
                if dev != "cuda":
                    raise
                print("cuda load failed, falling back to cpu:", e, flush=True)
                torch.cuda.empty_cache()
                dev = "cpu"
                m = whisper.load_model(name, device=dev)
            state["device"] = dev
        else:
            import onnx_asr
            d = os.path.join(args.models, "parakeet-tdt-0.6b-v3")
            if not os.path.exists(os.path.join(d, "config.json")):
                job["stage"] = "downloading"
                from huggingface_hub import snapshot_download
                snapshot_download(PARAKEET_REPO, local_dir=d)
            asr = onnx_asr.load_model(PARAKEET_NAME, d)
            vad = onnx_asr.load_vad("silero")
            m = asr.with_vad(vad)
            state["device"] = "cpu"
        state["model"] = m
        state["name"] = name
        return m
    finally:
        state["loading"] = False


# ---------- Audio ----------

def to_wav(src, job=None):
    fd, out = tempfile.mkstemp(prefix="axon-asr-", suffix=".wav")
    os.close(fd)
    # stderr goes to a temp file, not a pipe: polling without draining a pipe
    # would deadlock ffmpeg once the buffer fills.
    errf = tempfile.TemporaryFile(mode="w+t")
    proc = subprocess.Popen(
        ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", out],
        stdout=subprocess.DEVNULL, stderr=errf, text=True,
    )
    try:
        deadline = time.monotonic() + FFMPEG_TIMEOUT
        while proc.poll() is None:
            if job is not None and job.get("cancel"):
                proc.kill()
                raise Cancelled()
            if time.monotonic() > deadline:
                proc.kill()
                raise RuntimeError("ffmpeg: la conversión de audio agotó el tiempo")
            time.sleep(0.3)
        if proc.returncode != 0:
            errf.seek(0)
            msg = errf.read().strip().splitlines()
            raise RuntimeError("ffmpeg: " + (msg[-1] if msg else "no se pudo leer el audio"))
        with wave.open(out) as w:
            dur = w.getnframes() / float(w.getframerate() or 16000)
        return out, dur
    except Exception:
        try:
            os.unlink(out)
        except OSError:
            pass
        raise
    finally:
        errf.close()
        if proc.poll() is None:
            proc.kill()
            try:
                proc.wait(timeout=5)
            except Exception:
                pass


# ---------- Engines ----------

def run_whisper(job, model, wav, dur):
    import whisper.transcribe as wt

    class Progress:
        def __init__(self, total=None, **_):
            self.total = total or 1
            self.n = 0

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def update(self, n=1):
            self.n += n
            job["pct"] = min(99, round(self.n * 100 / self.total))
            touch()
            if job.get("cancel"):
                raise Cancelled()

    wt.tqdm = types.SimpleNamespace(tqdm=Progress)
    opts = job["opts"]
    kw = {
        "language": opts.get("language") or None,
        "task": "translate" if opts.get("task") == "translate" else "transcribe",
        "verbose": None,
        "fp16": state["device"] == "cuda",
        "condition_on_previous_text": False,
    }
    if opts.get("prompt"):
        kw["initial_prompt"] = str(opts["prompt"])[:600]
    if opts.get("words"):
        kw["word_timestamps"] = True
    r = model.transcribe(wav, **kw)
    segs = []
    for s in r.get("segments", []):
        t = (s.get("text") or "").strip()
        if not t:
            continue
        seg = {"start": round(float(s["start"]), 3), "end": round(float(s["end"]), 3), "text": t}
        if opts.get("words") and s.get("words"):
            seg["words"] = [{"w": w["word"], "s": round(float(w["start"]), 2), "e": round(float(w["end"]), 2)} for w in s["words"]]
        segs.append(seg)
    return {"language": r.get("language"), "segments": segs}


def run_parakeet(job, model, wav, dur):
    segs = []
    for s in model.recognize(wav):
        if job.get("cancel"):
            raise Cancelled()
        t = (getattr(s, "text", "") or "").strip()
        end = float(getattr(s, "end", 0) or 0)
        if t:
            segs.append({"start": round(float(getattr(s, "start", 0) or 0), 3), "end": round(end, 3), "text": t})
        if dur:
            job["pct"] = min(99, round(end * 100 / dur))
        touch()
    return {"language": None, "segments": segs}


def worker():
    while True:
        jid = q.get()
        job = jobs.get(jid)
        if not job or job["state"] != "queued":
            continue
        state["busy"] = jid
        touch()
        wav = None
        try:
            job["state"] = "running"
            job["stage"] = "audio"
            wav, dur = to_wav(job["path"], job)
            job["duration"] = round(dur, 2)
            if job.get("cancel"):
                raise Cancelled()
            model = load(job["opts"].get("model") or ("turbo" if args.engine == "whisper" else PARAKEET_NAME), job)
            job["stage"] = "transcribing"
            t0 = time.time()
            res = (run_whisper if args.engine == "whisper" else run_parakeet)(job, model, wav, dur)
            res.update({
                "engine": args.engine,
                "model": state["name"],
                "device": state["device"],
                "duration": round(dur, 2),
                "elapsed": round(time.time() - t0, 2),
            })
            job["result"] = res
            job["state"] = "done"
            job["pct"] = 100
        except Cancelled:
            job["state"] = "cancelled"
        except Exception as e:  # noqa: BLE001 — report everything to Axon
            traceback.print_exc()
            job["state"] = "error"
            job["error"] = str(e)[-500:] or e.__class__.__name__
        finally:
            if wav:
                try:
                    os.unlink(wav)
                except OSError:
                    pass
            job["finished"] = time.time()
            state["busy"] = None
            touch()


def reaper():
    while True:
        time.sleep(15)
        idle = time.time() - state["last"]
        if state["busy"] is None and q.empty() and not state["loading"] and idle > args.idle:
            print(f"idle {int(idle)}s — exiting to free memory", flush=True)
            os._exit(0)
        # Forget finished jobs Axon already collected long ago.
        with lock:
            cut = time.time() - 3600
            for jid in list(order):
                j = jobs.get(jid)
                if j and j.get("finished") and j["finished"] < cut:
                    jobs.pop(jid, None)
                    order.remove(jid)


# ---------- HTTP ----------

class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def authed(self):
        # Fail closed: an empty TOKEN means the launcher never provisioned one,
        # so nothing may authenticate rather than everything.
        if not TOKEN:
            return False
        return hmac.compare_digest((self.headers.get("X-Axon-Token") or "").encode(), TOKEN.encode())

    def body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            return None
        if n < 0 or n > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(n) or b"{}") if n else {}
        except ValueError:
            return None

    def health(self):
        return {
            "ok": True,
            "engine": args.engine,
            "pid": os.getpid(),
            "model": state["name"],
            "device": state["device"],
            "loaded": state["model"] is not None,
            "loading": state["loading"],
            "busy": state["busy"],
            "queue": q.qsize(),
            "idle": args.idle,
            "idleLeft": max(0, int(args.idle - (time.time() - state["last"]))) if state["busy"] is None else args.idle,
        }

    def do_GET(self):
        if not self.authed():
            return self.send(401, {"ok": False, "error": "unauthorized"})
        if self.path == "/health":
            return self.send(200, self.health())
        if self.path.startswith("/jobs/"):
            j = jobs.get(self.path[6:])
            if not j:
                return self.send(404, {"ok": False, "error": "job not found"})
            return self.send(200, {"ok": True, **{k: v for k, v in j.items() if k != "opts"}})
        self.send(404, {"ok": False})

    def do_POST(self):
        if not self.authed():
            return self.send(401, {"ok": False, "error": "unauthorized"})
        if self.path == "/jobs":
            b = self.body()
            if not isinstance(b, dict):
                return self.send(400, {"ok": False, "error": "cuerpo inválido"})
            p = b.get("path")
            if not isinstance(p, str) or not os.path.isfile(p):
                return self.send(400, {"ok": False, "error": "archivo no encontrado"})
            jid = uuid.uuid4().hex[:12]
            with lock:
                jobs[jid] = {"id": jid, "path": p, "opts": b.get("opts") or {}, "state": "queued", "stage": "queued",
                             "pct": 0, "created": time.time()}
                order.append(jid)
            touch()
            q.put(jid)
            return self.send(200, {"ok": True, "id": jid})
        if self.path == "/shutdown":
            self.send(200, {"ok": True})
            threading.Timer(0.2, lambda: os._exit(0)).start()
            return
        if self.path == "/unload":
            if state["busy"] is None:
                free_model()
            return self.send(200, {"ok": True})
        self.send(404, {"ok": False})

    def do_DELETE(self):
        if not self.authed():
            return self.send(401, {"ok": False, "error": "unauthorized"})
        if self.path.startswith("/jobs/"):
            j = jobs.get(self.path[6:])
            if j:
                j["cancel"] = True
                if j["state"] == "queued":
                    j["state"] = "cancelled"
                    j["finished"] = time.time()
            return self.send(200, {"ok": True})
        self.send(404, {"ok": False})


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), H)
    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=reaper, daemon=True).start()
    print(f"axon-asr {args.engine} listening on 127.0.0.1:{args.port} (idle {args.idle}s)", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
