// MozJPEG (Squoosh's JPEG codec, via @jsquash/jpeg WASM) off the main thread.
// Receives raw RGBA pixels, posts back the encoded JPEG bytes.
import { readFileSync } from 'node:fs';
import encode, { init } from '@jsquash/jpeg/encode.js';

declare const self: Worker;

const ready = (async () => {
  const wasm = await WebAssembly.compile(readFileSync(require.resolve('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm')));
  await init(wasm);
})();

self.onmessage = async (e: MessageEvent<{ id: string; data: Uint8Array; width: number; height: number; quality: number }>) => {
  const { id, data, width, height, quality } = e.data;
  try {
    await ready;
    const img = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height, colorSpace: 'srgb' };
    const out = await encode(img as unknown as ImageData, { quality, progressive: true, optimize_coding: true, trellis_multipass: false });
    self.postMessage({ id, ok: true, out: new Uint8Array(out) }, [out] as unknown as Transferable[]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err as Error)?.message || err) });
  }
};
