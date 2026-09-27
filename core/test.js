const { plan } = require('./profiles');

const CASES = [
  {
    name: 'DaVinci export: 4K 60fps Dolby Vision → Instagram Reels (iOS app)',
    src: { path: 'master.mov', width: 2160, height: 3840, fps: 60, vfr: false,
           hdr: true, hdrFormat: 'dolbyvision', bitrateMbps: 180, durationSec: 30 },
    platform: 'ig_reels', opts: { uploadPath: 'ios_app' },
  },
  {
    name: 'Same file → Instagram Reels via WEB (HDR impossible)',
    src: { path: 'master.mov', width: 2160, height: 3840, fps: 60, vfr: false,
           hdr: true, hdrFormat: 'dolbyvision', bitrateMbps: 180, durationSec: 30 },
    platform: 'ig_reels', opts: { uploadPath: 'web' },
  },
  {
    name: 'Same file → TikTok (HDR now PRESERVED — corrected)',
    src: { path: 'master.mov', width: 2160, height: 3840, fps: 60, vfr: false,
           hdr: true, hdrFormat: 'dolbyvision', bitrateMbps: 180, durationSec: 30 },
    platform: 'tiktok', opts: { uploadPath: 'web' },
  },
  {
    name: 'THE FPS TEST — 1080p60 SDR export → TikTok (must stay 60)',
    src: { path: 'edit.mp4', width: 1080, height: 1920, fps: 60, vfr: false,
           hdr: false, bitrateMbps: 45, durationSec: 22 },
    platform: 'tiktok', opts: { uploadPath: 'web' },
  },
  {
    name: '120fps source → TikTok (clean ÷2 to 60, not ragged decimation)',
    src: { path: 'slowmo.mov', width: 1080, height: 1920, fps: 120, vfr: false,
           hdr: false, bitrateMbps: 90, durationSec: 15 },
    platform: 'tiktok', opts: { uploadPath: 'web' },
  },
  {
    name: 'iPhone VFR HLG straight off the camera roll → Instagram Story',
    src: { path: 'IMG_0421.MOV', width: 1080, height: 1920, fps: 29.97, vfr: true,
           hdr: true, hdrFormat: 'hlg', bitrateMbps: 22, durationSec: 14 },
    platform: 'ig_story', opts: { uploadPath: 'mobile' },
  },
  {
    name: 'HDR10+ master → Instagram Reels iOS (format has no ingest path)',
    src: { path: 'hdr10plus.mp4', width: 1080, height: 1920, fps: 30, vfr: false,
           hdr: true, hdrFormat: 'hdr10plus', bitrateMbps: 120, durationSec: 40 },
    platform: 'ig_reels', opts: { uploadPath: 'ios_app' },
  },
  {
    name: 'Low-bitrate 720p re-upload → TikTok (must not upscale or inflate)',
    src: { path: 'repost.mp4', width: 720, height: 1280, fps: 30, vfr: false,
           hdr: false, bitrateMbps: 3.2, durationSec: 60 },
    platform: 'tiktok', opts: { uploadPath: 'mobile' },
  },
];

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log(`      ✓ ${label}`); }
  else { fail++; console.log(`      ✗ FAIL: ${label}`); }
}

for (const c of CASES) {
  const r = plan(c.src, c.platform, c.opts);
  const o = r.output;
  console.log(`\n${'─'.repeat(78)}\n▸ ${c.name}`);
  console.log(`  OUT  ${o.width}×${o.height} @ ${o.fps}fps ${o.fpsMode.toUpperCase()} · ` +
              `${o.codec} ${o.pixFmt} · ${o.hdr ? 'HDR/' + o.hdrTarget : 'SDR'} · ` +
              `${o.targetMbps} Mbps · ~${o.estimatedSizeMB} MB`);
  console.log(`  FPS  ${r.decisions.fps.reason}`);
  console.log(`  CLR  ${r.decisions.color.reason}`);
  r.warnings.forEach(w => console.log(`  ⚠   ${w}`));
}

console.log(`\n${'═'.repeat(78)}\nASSERTIONS\n`);

console.log('  60fps source must emit exactly 60fps:');
[['tiktok','web'],['ig_reels','ios_app'],['yt_shorts','web']].forEach(([p, u]) => {
  const r = plan({ width:1080, height:1920, fps:60, hdr:false, bitrateMbps:45, durationSec:20 }, p, { uploadPath:u });
  check(`${p}: ${r.output.fps} fps`, r.output.fps === 60);
});

console.log('  59.94 must NOT be rounded to 60 (would duplicate frames):');
const r5994 = plan({ width:1080, height:1920, fps:59.94, hdr:false, bitrateMbps:40, durationSec:20 }, 'tiktok');
check(`got ${r5994.output.fps}`, r5994.output.fps === 59.94);

console.log('  120fps must land on exactly 60 via integer divisor:');
const r120 = plan({ width:1080, height:1920, fps:120, hdr:false, bitrateMbps:90, durationSec:10 }, 'tiktok');
check(`got ${r120.output.fps} (÷${r120.decisions.fps.divisor})`, r120.output.fps === 60 && r120.decisions.fps.divisor === 2);

console.log('  Never upscale:');
const rUp = plan({ width:720, height:1280, fps:30, hdr:false, bitrateMbps:3.2, durationSec:30 }, 'tiktok');
check(`720×1280 stayed ${rUp.output.width}×${rUp.output.height}`, rUp.output.width === 720 && rUp.output.height === 1280);

console.log('  Never exceed source bitrate meaningfully:');
check(`3.2 Mbps source → ${rUp.output.targetMbps} Mbps out`, rUp.output.targetMbps <= 3.2 * 1.15);

console.log('  HDR survives only on the iOS path for Instagram:');
const hdrSrc = { width:1080, height:1920, fps:30, hdr:true, hdrFormat:'dolbyvision', bitrateMbps:100, durationSec:20 };
check('ios_app keeps HDR',  plan(hdrSrc,'ig_reels',{uploadPath:'ios_app'}).output.hdr === true);
check('web tonemaps to SDR', plan(hdrSrc,'ig_reels',{uploadPath:'web'}).output.hdr === false);
check('tiktok KEEPS HDR (corrected 2026-09)', plan(hdrSrc,'tiktok',{uploadPath:'web'}).output.hdr === true);

console.log('  Landscape 4K must become 1920x1080, not squeezed:');
const rLand = plan({ width:3840, height:2160, fps:60, hdr:false, bitrateMbps:120, durationSec:20 }, 'tiktok');
check(`3840x2160 -> ${rLand.output.width}x${rLand.output.height}`, rLand.output.width === 1920 && rLand.output.height === 1080);

console.log('  Portrait 4K must become 1080x1920:');
const rPort = plan({ width:2160, height:3840, fps:60, hdr:false, bitrateMbps:120, durationSec:20 }, 'tiktok');
check(`2160x3840 -> ${rPort.output.width}x${rPort.output.height}`, rPort.output.width === 1080 && rPort.output.height === 1920);

console.log('  Story caps at 30fps, and says so:');
const rStory = plan({ width:1080, height:1920, fps:60, hdr:false, bitrateMbps:40, durationSec:14 }, 'ig_story');
check(`got ${rStory.output.fps} fps (÷${rStory.decisions.fps.divisor})`, rStory.output.fps === 30);

console.log('  Output is always CFR:');
check('fpsMode === cfr', CASES.every(c => plan(c.src, c.platform, c.opts).output.fpsMode === 'cfr'));

console.log(`\n${'═'.repeat(78)}`);
console.log(`${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed`);

console.log(`\nSample FFmpeg command (4K60 DV → Reels iOS):\n`);
console.log('  ffmpeg ' + plan(CASES[0].src, 'ig_reels', { uploadPath:'ios_app' }).ffmpeg.join(' ') + '\n');
process.exit(fail === 0 ? 0 : 1);
