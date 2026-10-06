import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { playbackEncoding } from './media-playback';

async function run(args: string[]) {
  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code) throw new Error(stderr);
  return stdout;
}
const probe = (file: string) => run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,pix_fmt', '-of', 'json', file]);

test('container fallback preserves an H.264 stream byte for byte and adapts incompatible audio', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'axon-playback-'));
  try {
    const original = path.join(dir, 'original.mkv'), output = path.join(dir, 'web.mp4');
    await run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:d=0.3', '-f', 'lavfi', '-i', 'sine=duration=0.3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', original]);
    const encoding = playbackEncoding(await probe(original), true);
    expect(encoding.video).toBe('-c:v copy');
    await run(['bash', '-c', `ffmpeg -v error -i '${original}' -map 0:v:0 -map 0:a:0? ${encoding.video} ${encoding.audio} -movflags +faststart '${output}'`]);
    const videoHash = (file: string) => run(['ffmpeg', '-v', 'error', '-i', file, '-map', '0:v:0', '-c:v', 'copy', '-f', 'hash', '-hash', 'sha256', '-']);
    expect(await videoHash(output)).toBe(await videoHash(original));
    const streams = JSON.parse(await probe(output)).streams;
    expect(streams.map((s: any) => s.codec_name)).toEqual(['h264', 'aac']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ProRes / 4:2:2 fallback produces playable H.264 with 4:2:0 pixels', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'axon-playback-'));
  try {
    const original = path.join(dir, 'original.mov'), output = path.join(dir, 'web.mp4');
    await run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:d=0.3', '-c:v', 'prores_ks', '-pix_fmt', 'yuv422p10le', '-threads', '1', original]);
    const encoding = playbackEncoding(await probe(original), true);
    await run(['bash', '-c', `ffmpeg -v error -i '${original}' -map 0:v:0 -map 0:a:0? ${encoding.video} ${encoding.audio} -movflags +faststart '${output}'`]);
    const video = JSON.parse(await probe(output)).streams[0];
    expect(video.codec_name).toBe('h264'); expect(video.pix_fmt).toBe('yuv420p');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('unknown and 10-bit codecs use a conservative fallback; heavy sharing retains its optimization', () => {
  for (const data of ['broken', 'null', '{"streams":{}}', '{"streams":[{"codec_type":"video","codec_name":"hevc","pix_fmt":"yuv420p"}]}', '{"streams":[{"codec_type":"video","codec_name":"h264","pix_fmt":"yuv420p10le"}]}']) {
    expect(playbackEncoding(data, true).video).toContain('libx264');
  }
  const input = '{"streams":[{"codec_type":"video","codec_name":"h264","pix_fmt":"yuv420p"},{"codec_type":"audio","codec_name":"aac"}]}';
  expect(playbackEncoding(input, true)).toEqual({ video: '-c:v copy', audio: '-c:a copy' });
  expect(playbackEncoding(input, false).video).toContain('libx264');
});
