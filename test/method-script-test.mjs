/**
 * FFMPEG-method script generator — unit tests.
 * The generator must emit the exact creator recipe: true x265 re-encode,
 * 10-bit HLG for HDR sources, bt709 for SDR (never faked), TikTok timescale,
 * AAC 44.1k, faststart — wrapped in per-platform drag-and-drop scripts.
 */
import { methodArgs, methodCommand, methodScript, methodTimescale }
  from '../site/lib/method-script.js';

let pass = 0, fail = 0;
const chk = (l, c, extra = '') => {
  c ? (pass++, console.log(`  ✓ ${l}${extra}`)) : (fail++, console.log(`  ✗ FAIL ${l}${extra}`));
};

const HDR = { fileName: 'IMG_0001.MOV', width: 2160, height: 3840, fps: 60, hdr: true, hasDolbyVisionRPU: true, audioCodec: 'aac' };
const SDR = { fileName: 'clip.mp4', width: 720, height: 1280, fps: 30, hdr: false, audioCodec: 'aac' };

console.log('\n── 1. Timescale convention (measured from delivered files) ──');
chk('60fps → 19200', methodTimescale(60) === 19200);
chk('120fps → 19200 (divides cleanly)', methodTimescale(120) === 19200);
chk('30fps → 15360', methodTimescale(30) === 15360);
chk('24fps → 19200', methodTimescale(24) === 19200);

console.log('\n── 2. HDR recipe ──');
const a = methodArgs(HDR);
const j = a.join(' ');
chk('true x265 re-encode', a.includes('libx265'));
chk('Apple playback tag hvc1', a.includes('hvc1'));
chk('10-bit pixel format', a.includes('p010le'));
chk('main10 profile', j.includes('profile=main10'));
chk('bt2020 / HLG / bt2020nc signalled', j.includes('colorprim=bt2020') && j.includes('transfer=arib-std-b67') && j.includes('colormatrix=bt2020nc')
  && a.includes('bt2020') && a.includes('arib-std-b67'));
chk('high bitrate 20M', j.includes('-b:v 20M'));
chk('TikTok timescale 19200 for 60fps', j.includes('-video_track_timescale 19200'));
chk('audio → aac 192k 44.1kHz', j.includes('-c:a aac') && j.includes('-b:a 192k') && j.includes('-ar 44100'));
chk('faststart', j.includes('+faststart'));
chk('scale capped to 1080x1920, never upscaled', j.includes("min(iw,1080)") && j.includes('min(ih,1920)'));
chk('extra tracks dropped', j.includes('-map 0:v:0') && j.includes('-map 0:a:0?'));
chk('metadata stripped', j.includes('-map_metadata -1'));

console.log('\n── 3. SDR honesty ──');
const s = methodArgs(SDR).join(' ');
chk('stays 8-bit bt709 (no fake HDR)', s.includes('yuv420p') && !s.includes('p010le') && s.includes('bt709') && !s.includes('arib-std-b67'));
chk('30fps → timescale 15360', s.includes('-video_track_timescale 15360'));

console.log('\n── 4. Copy-paste command ──');
const c = methodCommand(HDR);
chk('starts with ffmpeg', c.startsWith('ffmpeg -hide_banner -y -i input.mp4'));
chk('output named input-method.mp4', c.includes('input-method.mp4'));
chk('single -y', (c.match(/ -y /g) || []).length === 1);

console.log('\n── 5. Windows .bat ──');
const bat = methodScript(HDR, {}, 'win');
chk('drag-and-drop arg %~1', bat.includes('"%~1"'));
chk('output lands next to the video', bat.includes('%~dpn1-method.mp4'));
chk('auto-installs ffmpeg via winget', bat.includes('winget') && bat.includes('where ffmpeg'));
chk('preset/bitrate editable via variables', bat.includes('-preset %PRESET%') && bat.includes('-b:v %BITRATE%'));
chk('CRLF line endings', bat.includes('\r\n'));
chk('carries the full recipe', bat.includes('libx265') && bat.includes('p010le') && bat.includes('19200'));

console.log('\n── 6. macOS .command / Linux .sh ──');
const mac = methodScript(HDR, {}, 'mac');
chk('mac: zsh + Homebrew auto-install', mac.startsWith('#!/zsh') && mac.includes('brew install ffmpeg'));
chk('mac: output via ${INPUT:r}', mac.includes('${INPUT:r}-method.mp4'));
chk('mac: preset/bitrate variables', mac.includes('-preset "${PRESET}"') && mac.includes('-b:v "${BITRATE}"'));
const lin = methodScript(SDR, {}, 'linux');
chk('linux: bash + apt hint', lin.startsWith('#!/bash') && lin.includes('apt install ffmpeg'));
chk('linux: output via ${INPUT%.*}', lin.includes('${INPUT%.*}-method.mp4'));

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
