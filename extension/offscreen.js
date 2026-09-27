/**
 * Vague Guard — offscreen encoder
 *
 * Runs in an extension offscreen document, not in the TikTok tab. That matters:
 * the host page's COOP/COEP headers are not ours to set, and media capture is
 * blocked in content scripts.
 *
 * Strategy: <video> → captureStream() → MediaRecorder(H.264 + AAC in MP4).
 * This uses the browser's HARDWARE encoder, keeps audio, and needs no wasm.
 *
 * Trade-off: capture runs at playback speed, so a 60s clip takes ~60s.
 * Accepted for v1 — it is reliable and produces a genuinely clean file.
 * The WebCodecs path (faster than realtime) is noted at the bottom.
 */

'use strict';

const MP4_CANDIDATES = [
  'video/mp4;codecs=avc1.640034,mp4a.40.2',  // High@5.2 — 4K capable
  'video/mp4;codecs=avc1.64002A,mp4a.40.2',  // High@4.2 — 1080p60
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',  // Baseline fallback
  'video/mp4',
  'video/webm;codecs=h264,opus',
];

function pickMime() {
  for (const m of MP4_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

function post(msg) { chrome.runtime.sendMessage({ target: 'vg-progress', ...msg }); }

async function transcode({ blobUrl, plan, jobId }) {
  const o = plan.output;
  const mimeType = pickMime();
  if (!mimeType) throw new Error('This browser cannot record MP4 or H.264.');

  const video = document.createElement('video');
  video.src = blobUrl;
  video.muted = false;
  video.volume = 1;
  video.playsInline = true;
  video.preload = 'auto';

  await new Promise((res, rej) => {
    video.onloadedmetadata = res;
    video.onerror = () => rej(new Error('Could not decode this video in the browser.'));
  });

  const duration = video.duration;

  // Draw into a canvas at the target resolution so we control the scale,
  // rather than letting captureStream hand us the source size.
  const canvas = document.createElement('canvas');
  canvas.width = o.width;
  canvas.height = o.height;
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Letterbox-free cover fit (no upscaling beyond the target box)
  const sw = video.videoWidth, sh = video.videoHeight;
  const scale = Math.min(o.width / sw, o.height / sh);
  const dw = Math.round(sw * scale), dh = Math.round(sh * scale);
  const dx = ((o.width - dw) / 2) | 0, dy = ((o.height - dh) / 2) | 0;

  const vStream = canvas.captureStream(o.fps);
  const track = vStream.getVideoTracks()[0];

  // Attach the original audio untouched where possible
  const out = new MediaStream([track]);
  try {
    const aStream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
    for (const a of aStream.getAudioTracks()) out.addTrack(a);
  } catch { /* video-only source */ }

  const chunks = [];
  const rec = new MediaRecorder(out, {
    mimeType,
    videoBitsPerSecond: Math.round(o.targetMbps * 1_000_000),
    audioBitsPerSecond: 192_000,
  });
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

  const done = new Promise((res, rej) => {
    rec.onstop = res;
    rec.onerror = e => rej(e.error || new Error('Recorder failed'));
  });

  // Paint loop locked to the source's own frames — this is what preserves
  // the exported frame rate instead of resampling it.
  let painted = 0;
  const paint = () => {
    ctx.drawImage(video, dx, dy, dw, dh);
    painted++;
    if (painted % 15 === 0) {
      post({ jobId, stage: 'encoding', pct: Math.min(99, (video.currentTime / duration) * 100) });
    }
    if (!video.ended && !video.paused) {
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(paint);
      else requestAnimationFrame(paint);
    }
  };

  rec.start(1000);
  await video.play();
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(paint);
  else requestAnimationFrame(paint);

  await new Promise(res => { video.onended = res; });
  // flush the tail
  await new Promise(r => setTimeout(r, 300));
  rec.stop();
  await done;

  track.stop();
  URL.revokeObjectURL(blobUrl);

  const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
  post({ jobId, stage: 'done', pct: 100 });
  return blob;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'vg-offscreen') return;
  if (msg.type === 'transcode') {
    transcode(msg.payload)
      .then(async blob => {
        const buf = await blob.arrayBuffer();
        sendResponse({ ok: true, buf: Array.from(new Uint8Array(buf)), type: blob.type });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }
});

/* ---------------------------------------------------------------------------
 * UPGRADE PATH — WebCodecs (faster than realtime, 10-bit capable)
 *
 *   const enc = new VideoEncoder({ output: chunk => muxer.addVideoChunk(chunk),
 *                                  error: e => reject(e) });
 *   enc.configure({ codec: 'avc1.64002A', width, height,
 *                   bitrate: targetMbps * 1e6, framerate: fps,
 *                   hardwareAcceleration: 'prefer-hardware',
 *                   latencyMode: 'quality' });
 *
 * Needs an MP4 muxer (mp4-muxer, ~12 KB) and a demuxer to feed VideoDecoder.
 * Gains: 5–10× faster, exact frame timing, and HEVC 10-bit where the platform
 * supports it. Does NOT solve Dolby Vision — the RPU still requires the Nova
 * server path, because no browser API can write DV metadata.
 * ------------------------------------------------------------------------- */
