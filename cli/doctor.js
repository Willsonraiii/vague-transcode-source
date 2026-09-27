#!/usr/bin/env node
/**
 * Vague Doctor — preflight check.
 *
 * Finds out in ~30 seconds whether your machine can actually do the job,
 * instead of discovering it after a 10 minute encode fails.
 *
 * The important test is #5: it runs a real 1-frame x265 encode with the
 * Dolby Vision parameters. Many ffmpeg builds ship an x265 without DV
 * support, and that is the single most common reason this pipeline fails.
 */

'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const C = { r:'\x1b[31m', g:'\x1b[32m', y:'\x1b[33m', b:'\x1b[36m', d:'\x1b[2m', x:'\x1b[0m', B:'\x1b[1m' };
const WIN = process.platform === 'win32';
const FFMPEG_FIX = WIN
  ? 'winget install Gyan.FFmpeg   — then open a NEW terminal'
  : 'Debian/Ubuntu: sudo apt install ffmpeg   |   Fedora: sudo dnf install ffmpeg   |   Arch: sudo pacman -S ffmpeg';
const FULLBUILD_FIX = WIN
  ? 'Get ffmpeg-release-FULL from gyan.dev (not "essentials")'
  : 'Distro ffmpeg often lacks DV. Use a static build: https://johnvansickle.com/ffmpeg/ or https://github.com/BtbN/FFmpeg-Builds/releases';
const DOVI_FIX = WIN
  ? 'https://github.com/quietvoid/dovi_tool/releases → put dovi_tool.exe next to ffmpeg.exe'
  : 'https://github.com/quietvoid/dovi_tool/releases → download the x86_64-unknown-linux-musl tarball, then: sudo install dovi_tool /usr/local/bin/';
const say = (...a) => console.log(...a);
let fatal = 0, warn = 0;

const PASS = (l, extra='') => say(`  ${C.g}✓${C.x} ${l}${extra ? C.d+'  '+extra+C.x : ''}`);
const WARN = (l, fix)      => { warn++;  say(`  ${C.y}!${C.x} ${l}`); if (fix) say(`      ${C.d}${fix}${C.x}`); };
const FAIL = (l, fix)      => { fatal++; say(`  ${C.r}✗${C.x} ${l}`); if (fix) say(`      ${C.y}${fix}${C.x}`); };

function run(bin, args, timeout = 25000) {
  return spawnSync(bin, args, { encoding:'utf8', timeout, maxBuffer: 1<<26 });
}
function exists(bin, verArgs = ['-version']) {
  const r = run(bin, verArgs, 8000);
  if (r.error) return null;
  return ((r.stdout || '') + (r.stderr || '')).split('\n')[0].trim();
}

say(`\n${C.B}Vague Doctor${C.x}\n${'═'.repeat(58)}`);

/* 1 ─ node ---------------------------------------------------------------- */
say(`\n${C.B}1. Node.js${C.x}`);
const nv = process.versions.node;
if (+nv.split('.')[0] >= 16) PASS(`node ${nv}`);
else FAIL(`node ${nv} is too old`, 'Install Node 18+ from https://nodejs.org');

/* 2 ─ ffmpeg / ffprobe ---------------------------------------------------- */
say(`\n${C.B}2. ffmpeg${C.x}`);
const ff = exists('ffmpeg');
const fp = exists('ffprobe');
if (ff) PASS('ffmpeg found', ff.replace('ffmpeg version ','').slice(0, 40));
else FAIL('ffmpeg NOT on PATH', FFMPEG_FIX);
if (fp) PASS('ffprobe found');
else FAIL('ffprobe NOT on PATH', 'It ships with ffmpeg — check your PATH');

/* 3 ─ libx265 ------------------------------------------------------------- */
say(`\n${C.B}3. HEVC encoder${C.x}`);
let hasX265 = false;
if (ff) {
  const enc = run('ffmpeg', ['-hide_banner','-encoders']).stdout || '';
  hasX265 = /\blibx265\b/.test(enc);
  if (hasX265) {
    const probeTxt = (run('ffmpeg', ['-hide_banner','-h','encoder=libx265']).stdout || '') +
      (run('ffmpeg', ['-hide_banner','-version']).stdout || '');
    const ver = probeTxt.match(/x265[\s_-]+v?([\d]+\.[\d]+)/i);
    PASS('libx265 present', ver ? 'x265 ' + ver[1] : '(version not reported)');
  }
  else FAIL('libx265 MISSING — cannot encode HDR at all', FULLBUILD_FIX);

  if (/hevc_nvenc/.test(enc)) PASS('hevc_nvenc present', '(GPU available for SDR speed)');
  else say(`  ${C.d}·  hevc_nvenc not present (fine — CPU encoding still works)${C.x}`);
}

/* 4 ─ dovi_tool ----------------------------------------------------------- */
say(`\n${C.B}4. dovi_tool${C.x}`);
const dv = exists('dovi_tool', ['--version']);
if (dv) PASS('dovi_tool found', dv.slice(0, 40));
else WARN('dovi_tool NOT on PATH — Dolby Vision will be dropped (HLG base survives)', DOVI_FIX);

/* 5 ─ THE IMPORTANT ONE: does x265 accept Dolby Vision params? ------------ */
say(`\n${C.B}5. Dolby Vision encode capability  ${C.d}(the one that usually fails)${C.x}`);
if (!ff || !hasX265) {
  say(`  ${C.d}skipped — needs ffmpeg with libx265${C.x}`);
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vaguedoc-'));
  const SRC = ['-f','lavfi','-i','testsrc2=size=320x320:rate=30:duration=0.3'];

  // 5a — baseline HDR10 encode. If this fails, the problem is not Dolby Vision.
  const base = path.join(tmp, 'base.mp4');
  const rBase = run('ffmpeg', ['-hide_banner','-y', ...SRC,
    '-c:v','libx265','-preset','ultrafast','-profile:v','main10','-pix_fmt','yuv420p10le',
    '-x265-params','hdr-opt=1:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc',
    base], 40000);
  const baseOk = fs.existsSync(base) && fs.statSync(base).size > 0;
  baseOk ? PASS('10-bit HDR10 encode works') 
         : FAIL('even a plain 10-bit HDR encode failed', 'libx265 itself is broken in this build');

  // 5b — now add the Dolby Vision profile, WITH the vbv settings x265 requires.
  if (baseOk) {
    const dvout = path.join(tmp, 'dv.mp4');
    const rDv = run('ffmpeg', ['-hide_banner','-y', ...SRC,
      '-c:v','libx265','-preset','ultrafast','-profile:v','main10','-pix_fmt','yuv420p10le',
      '-x265-params',
      'hdr-opt=1:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:' +
      'dolby-vision-profile=8.1:vbv-maxrate=20000:vbv-bufsize=40000:aud=1:hrd=1:' +
      // profile 8.1 (PQ base) additionally requires ST 2086 mastering display info
      'master-display=G(8500,39850)B(6550,2300)R(35400,14600)WP(15635,16450)L(10000000,1):' +
      'max-cll=1000,400',
      dvout], 40000);
    const blob = ((rDv.stdout||'') + (rDv.stderr||''));
    const built = fs.existsSync(dvout) && fs.statSync(dvout).size > 0;
    const unknownOpt = /unknown option[^\n]*dolby|dolby[^\n]*unknown option/i.test(blob);

    if (built && !unknownOpt) {
      PASS('x265 accepted dolby-vision-profile', 'full DV pipeline available');
    } else if (unknownOpt) {
      FAIL('x265 does not know dolby-vision-profile — no DV support in this build', FULLBUILD_FIX);
    } else if (/requires Mastering display/i.test(blob)) {
      // The DV validator ran, which proves support exists.
      PASS('x265 HAS Dolby Vision support', 'it asked for mastering-display metadata');
    } else {
      // it errored for some other reason — surface it so we can see what
      WARN('DV test encode did not produce a file', 'see the x265 lines below');
      const lines = blob.split('\n')
        .filter(l => /x265|dolby|vbv|error/i.test(l))
        .slice(-4).join('\n      ');
      if (lines) say(`      ${C.d}${lines}${C.x}`);
      say(`      ${C.d}Note: profile 8.x normally also needs a real RPU file, which this${C.x}`);
      say(`      ${C.d}synthetic test has none of. A failure here is not conclusive —${C.x}`);
      say(`      ${C.d}the real run supplies an RPU extracted from your source.${C.x}`);
    }
  }
  fs.rmSync(tmp, { recursive:true, force:true });
}

/* 6 ─ 10-bit + HLG tagging ------------------------------------------------ */
say(`\n${C.B}6. HLG / 10-bit tagging${C.x}`);
if (ff && hasX265) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vaguedoc2-'));
  const out = path.join(tmp, 'h.mp4');
  run('ffmpeg', ['-hide_banner','-y','-f','lavfi',
    '-i','testsrc2=size=256x256:rate=30:duration=0.2',
    '-c:v','libx265','-preset','ultrafast','-profile:v','main10','-pix_fmt','yuv420p10le',
    '-x265-params','hdr-opt=1:repeat-headers=1:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc',
    '-colorspace','bt2020nc','-color_primaries','bt2020','-color_trc','arib-std-b67',
    '-tag:v','hvc1', out], 40000);
  if (fs.existsSync(out) && fp) {
    const j = run('ffprobe', ['-v','quiet','-print_format','json','-show_streams', out]).stdout;
    try {
      const s = JSON.parse(j).streams[0];
      const ok = s.color_trc === 'arib-std-b67' && /10/.test(String(s.bits_per_raw_sample || s.pix_fmt));
      ok ? PASS('HLG + 10-bit written and read back correctly')
         : WARN(`tags came back as trc=${s.color_trc} pix=${s.pix_fmt}`, 'HDR tagging may not survive');
    } catch { WARN('could not parse ffprobe output'); }
  } else WARN('test encode did not produce a file');
  fs.rmSync(tmp, { recursive:true, force:true });
} else say(`  ${C.d}skipped${C.x}`);

/* summary ----------------------------------------------------------------- */
say(`\n${'═'.repeat(58)}`);
if (fatal) {
  say(`${C.r}${C.B}  ${fatal} blocking problem${fatal>1?'s':''}${warn?` and ${warn} warning${warn>1?'s':''}`:''}.${C.x}`);
  say(`${C.d}  Fix the ✗ items above, then run this again.${C.x}\n`);
  process.exit(1);
} else if (warn) {
  say(`${C.y}${C.B}  Usable, with ${warn} warning${warn>1?'s':''}.${C.x}`);
  say(`${C.d}  You can encode now; the warnings limit what is preserved.${C.x}\n`);
} else {
  say(`${C.g}${C.B}  All good. Full pipeline available, Dolby Vision included.${C.x}`);
  say(`${C.d}  Next: ${WIN ? 'double-click Vague.bat' : './vague-app.sh'} and scan your master.${C.x}\n`);
}
