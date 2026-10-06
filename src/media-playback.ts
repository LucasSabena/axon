// Preserve compatible H.264 streams when only the container needs changing.
// Unknown, 10-bit and 4:2:2 inputs use the established H.264/AAC fallback.
export function playbackEncoding(probe: string, allowCopy: boolean): { video: string; audio: string } {
  let streams: { codec_type?: string; codec_name?: string; pix_fmt?: string }[] = [];
  try { const parsed = JSON.parse(probe)?.streams; streams = Array.isArray(parsed) ? parsed : []; } catch { /* conservative fallback */ }
  const video = streams.find(s => s.codec_type === 'video');
  const audio = streams.find(s => s.codec_type === 'audio');
  const copy = allowCopy && video?.codec_name === 'h264' && video.pix_fmt === 'yuv420p';
  return {
    video: copy ? '-c:v copy' : '-c:v libx264 -preset veryfast -crf 23 -profile:v high -vf "scale=\'if(gte(iw,ih),min(1920,iw),-2)\':\'if(gte(iw,ih),-2,min(1920,ih))\',format=yuv420p"',
    audio: copy && (!audio || audio.codec_name === 'aac') ? '-c:a copy' : '-c:a aac -b:a 160k -ac 2',
  };
}
