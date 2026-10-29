#!/usr/bin/env python3
"""Helper de Salud: lee procesos/recursos de /proc y aplica señales o prioridades.

Recibe una solicitud JSON por stdin y responde JSON por stdout. No ejecuta
comandos arbitrarios: las únicas acciones son `snapshot`, `signal` y `renice`, y
cada una verifica la identidad del proceso (pid + starttime) antes de tocarlo.
"""
import json, os, signal as sig, subprocess, sys, time

CLK = os.sysconf('SC_CLK_TCK')
PAGE = os.sysconf('SC_PAGE_SIZE')


def read(path, default=''):
    try:
        with open(path, 'r', errors='replace') as f:
            return f.read()
    except OSError:
        return default


def stat_fields(pid):
    raw = read(f'/proc/{pid}/stat')
    if not raw:
        return None
    # comm puede contener espacios y paréntesis: se corta en el último ')'.
    end = raw.rfind(')')
    rest = raw[end + 2:].split()
    return {'state': rest[0], 'ppid': int(rest[1]), 'utime': int(rest[11]), 'stime': int(rest[12]),
            'nice': int(rest[16]), 'threads': int(rest[17]), 'start': int(rest[19]), 'rss': int(rest[21]) * PAGE}


def uid_of(pid):
    try:
        return os.stat(f'/proc/{pid}').st_uid
    except OSError:
        return -1


def user_name(uid, cache={}):
    if uid not in cache:
        try:
            import pwd
            cache[uid] = pwd.getpwuid(uid).pw_name
        except Exception:
            cache[uid] = str(uid)
    return cache[uid]


def psi(name):
    out = {}
    for line in read(f'/proc/pressure/{name}').splitlines():
        parts = line.split()
        if not parts:
            continue
        out[parts[0]] = {k: float(v) for k, v in (p.split('=') for p in parts[1:]) if k != 'total'}
    return out


def meminfo():
    info = {}
    for line in read('/proc/meminfo').splitlines():
        k, _, v = line.partition(':')
        try:
            info[k] = int(v.split()[0]) * 1024
        except (ValueError, IndexError):
            pass
    return info


def cpu_times():
    total, cores = None, []
    for line in read('/proc/stat').splitlines():
        if line.startswith('cpu'):
            f = line.split()
            vals = [int(x) for x in f[1:9]]
            busy = sum(vals) - vals[3] - vals[4]
            row = [busy, sum(vals)]
            if f[0] == 'cpu':
                total = row
            else:
                cores.append(row)
    return total, cores


def temperature():
    best = None
    try:
        for name in os.listdir('/sys/class/thermal'):
            if not name.startswith('thermal_zone'):
                continue
            kind = read(f'/sys/class/thermal/{name}/type').strip()
            if kind in ('x86_pkg_temp', 'coretemp', 'k10temp', 'acpitz'):
                t = int(read(f'/sys/class/thermal/{name}/temp', '0').strip() or 0) / 1000
                if best is None or t > best:
                    best = t
    except OSError:
        pass
    return best


def frequency():
    vals = []
    try:
        for name in os.listdir('/sys/devices/system/cpu'):
            if name.startswith('cpu') and name[3:].isdigit():
                v = read(f'/sys/devices/system/cpu/{name}/cpufreq/scaling_cur_freq').strip()
                if v:
                    vals.append(int(v) / 1000)
    except OSError:
        pass
    return round(sum(vals) / len(vals)) if vals else None


def snapshot():
    procs = []
    for name in os.listdir('/proc'):
        if not name.isdigit():
            continue
        pid = int(name)
        st = stat_fields(pid)
        if not st:
            continue
        cmd = read(f'/proc/{pid}/cmdline').replace('\0', ' ').strip()
        kernel = not cmd
        if kernel:
            cmd = '[' + (read(f'/proc/{pid}/comm').strip() or str(pid)) + ']'
        uid = uid_of(pid)
        procs.append({'pid': pid, 'ppid': st['ppid'], 'uid': uid, 'user': user_name(uid), 'nice': st['nice'],
                      'state': st['state'], 'ticks': st['utime'] + st['stime'], 'start': st['start'],
                      'rss': st['rss'], 'threads': st['threads'], 'kernel': kernel, 'args': cmd[:600]})
    total, cores = cpu_times()
    mem = meminfo()
    return {'ok': True, 'now': time.time(), 'clk': CLK, 'ncpu': len(cores), 'cpuTotal': total, 'cpuCores': cores,
            'load': list(os.getloadavg()), 'uptime': float(read('/proc/uptime', '0').split()[0]),
            'mem': {'total': mem.get('MemTotal', 0), 'available': mem.get('MemAvailable', 0),
                    'cached': mem.get('Cached', 0), 'swapTotal': mem.get('SwapTotal', 0),
                    'swapFree': mem.get('SwapFree', 0)},
            'psi': {n: psi(n) for n in ('cpu', 'memory', 'io')}, 'temp': temperature(), 'freqMhz': frequency(),
            'procs': procs}


def verify(pid, start):
    st = stat_fields(pid)
    if not st or st['start'] != start:
        raise ValueError('El proceso cambió o ya terminó')
    if pid <= 2 or st['ppid'] == 2:
        raise ValueError('Proceso del sistema')
    return st


def do_signal(req):
    pid, start = int(req['pid']), int(req['start'])
    verify(pid, start)
    s = sig.SIGKILL if req.get('force') else sig.SIGTERM
    os.kill(pid, s)
    return {'ok': True}


def do_renice(req):
    changed = 0
    for item in req['items']:
        pid, start, nice = int(item['pid']), int(item['start']), int(item['nice'])
        try:
            verify(pid, start)
        except ValueError:
            continue
        tids = []
        try:
            tids = [int(t) for t in os.listdir(f'/proc/{pid}/task') if t.isdigit()]
        except OSError:
            tids = [pid]
        for tid in tids:
            try:
                # Sólo se sube el valor: bajarlo (más prioridad) no es parte de Salud.
                if os.getpriority(os.PRIO_PROCESS, tid) < nice:
                    os.setpriority(os.PRIO_PROCESS, tid, nice)
            except OSError:
                pass
        if item.get('io'):
            try:
                subprocess.run(['ionice', '-c', '3', '-p'] + [str(t) for t in tids[:64]], capture_output=True, timeout=5)
            except Exception:
                pass
        changed += 1
    return {'ok': True, 'changed': changed}


def main():
    try:
        req = json.loads(sys.stdin.read() or '{}')
        action = req.get('action')
        if action == 'snapshot':
            out = snapshot()
        elif action == 'signal':
            out = do_signal(req)
        elif action == 'renice':
            out = do_renice(req)
        else:
            out = {'ok': False, 'error': 'Acción desconocida'}
    except Exception as e:  # noqa: BLE001 — se informa al panel, no se propaga
        out = {'ok': False, 'error': str(e)[:300]}
    sys.stdout.write(json.dumps(out))


main()
