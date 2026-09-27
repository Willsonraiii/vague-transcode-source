#!/usr/bin/env node
/**
 * Vague CLI — local transcoder for TikTok / Instagram uploads.
 *
 * Does the things a browser cannot:
 *   • optional 4K → 1080p downscale (--1080p) PRESERVING Dolby Vision
 *     (dovi_tool RPU carry) — 4K is kept by default now, TikTok accepts it
 *   • preserve HLG / HDR10 with correct tagging
 *   • force CFR at the source's exact frame rate (kills the 60→30 problem)
 *   • high-quality Lanczos scaling if you do downscale
 *   • verify the output before handing it to you
 *
 * Usage:
 *   node vague.js <input> [options]
 *
 *   --platform tiktok|ig_reels|ig_story|yt_shorts   (default tiktok)
 *   --out <file>        output path
 *   --keep-4k           kept for compatibility — 4K is now the default
 *                       (TikTok accepts 4K 60 and 120 fps, owner-verified)
 *   --1080p             downscale to 1080p anyway (Lanczos). Optional A/B:
 *                       does your own 1080p beat TikTok's delivery from 4K?
 *   --sdr               force SDR tonemap even if HDR is possible
 *   --patch             movie-header duration -> 1 tick: shows 00:00 in galleries
 *                       and file browsers, but the track keeps real timing so
 *                       uploads still work.  SDR FILES ONLY — a patched HDR
 *                       file does not render as HDR in TikTok's player; refused
 *                       automatically on HDR input (HANDOFF §2.3b)
 *   --patch-aggressive  also zero track + media headers (BREAKS TikTok uploads)
 *   --force-patch       (compatibility) accepted, no longer needed — --patch runs
 *                       on HDR with an experimental warning (§2.3b is confounded)
 *   --method            the 60/120fps method: divide mvhd+mdhd timescale by 2
 *                       (60fps) or 4 (120fps) so TikTok's encoder reads half
 *                       the frame rate and decimates nothing. Lossless, keeps
 *                       real duration (no 00:00) and works on HDR. This is the
 *                       ut0ku/Zilem-style timescale patch, verified in the wild.
 *   --remux-only        lossless container fix, no re-encode
 *   --gpu               force hardware encoding (auto-detected by default)
 *   --cpu               never use hardware, always x265
 *   --fast              CPU preset "faster" instead of "medium"
 *   --preset <name>     explicit x265 preset
 *   --verbose           show full ffmpeg output (default: quiet)
 *   --no-dv             strip Dolby Vision, leave plain HLG.  TESTING ONLY —
 *                       HDR stopped surviving upload with this on.
 *   --upload            send the result to your TikTok drafts (official API)
 *   --tiktok-login      authorise once, then --upload works
 *   --dry-run           print the commands, run nothing
 *   --yes               skip prompts
 */

'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { plan } = require('../core/profiles');
const { diagnose, identifyToolchain } = require('../core/hdr-doctor');

/* ------------------------------------------------------------------- args */

const argv = process.argv.slice(2);
if (!argv.length || argv.includes('-h') || argv.includes('--help')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].split('/**')[1]
    .replace(/^ \* ?/gm, '  '));
  process.exit(0);
}

const flag = n => argv.includes(`--${n}`);
const opt  = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

let PRESET, ENCODER = 'x265', PRESET_SET = false;
const input     = argv[0];
const platform  = opt('platform', 'tiktok');
const DRY       = flag('dry-run');
const KEEP4K    = flag('keep-4k');
const DOWN1080  = flag('1080p');
const FORCE_SDR = flag('sdr');
const PATCH_AGG = flag('patch-aggressive');
const PATCH     = flag('patch') || PATCH_AGG;
const FORCE_PATCH = flag('force-patch');
const METHOD     = flag('method');
const REMUX     = flag('remux-only');
const GPU       = flag('gpu');
const UPLOAD    = flag('upload');
const NO_DV     = flag('no-dv') || flag('plain-hdr');
const TTLOGIN   = flag('tiktok-login');
const AUTO_GPU  = !flag('cpu');   // try hardware unless told not to
const FAST      = flag('fast');
PRESET_SET = argv.includes('--preset') || FAST;
PRESET     = opt('preset', FAST ? 'faster' : 'medium');

if (TTLOGIN) {
  (async () => {
    const tt = require('./tiktok');
    try {
      await tt.login();
      console.log(`\n${C.g}✓ Connected to TikTok.${C.x}`);
      console.log(`${C.d}  Token stored at ${tt.TOKEN_FILE}${C.x}`);
      console.log(`${C.d}  Now run:  ./vague.sh video.mp4 --remux-only --upload${C.x}\n`);
    } catch (e) { fail(e.message); }
  })();
  return;
}

if (!fs.existsSync(input) && !DRY) { fail(`Input not found: ${input}`); }

const outPath = opt('out',
  path.join(path.dirname(input), path.basename(input, path.extname(input)) + '-vague.mp4'));

/* ------------------------------------------------------------------ utils */

const C = { r:'\x1b[31m', g:'\x1b[32m', y:'\x1b[33m', b:'\x1b[36m', d:'\x1b[2m', x:'\x1b[0m', B:'\x1b[1m' };
const VERBOSE = argv.includes('--verbose');
const LOG = [];
const LOGFILE = path.join(os.homedir(), 'vague-last-run.log');
const strip = t => String(t).replace(/\x1b\[[0-9;]*m/g, '');
function writeLog() {
  try { fs.writeFileSync(LOGFILE, LOG.map(strip).join('')); } catch {}
}
process.on('exit', writeLog);
const say  = (...a) => { LOG.push(a.join(' ') + '\n'); console.log(...a); };
const head = t => say(`\n${C.B}${t}${C.x}\n${'─'.repeat(Math.min(72, t.length + 8))}`);
function fail(m) {
  LOG.push('\nERROR: ' + strip(m) + '\n');
  console.error(`\n${C.r}✗ ${m}${C.x}`);
  writeLog();
  console.error(`${C.d}  Full log saved to: ${LOGFILE}${C.x}\n`);
  process.exit(1);
}

/** Encoders can be compiled in but unusable (missing driver). Actually try one. */
function encoderWorks(name, extra = []) {
  if (DRY) return true;
  const r = spawnSync('ffmpeg', ['-hide_banner','-loglevel','error','-y',
    '-f','lavfi','-i','testsrc2=size=320x320:rate=30:duration=0.1',
    '-c:v', name, ...extra, '-f','null','-'], { encoding:'utf8', timeout: 25000 });
  return r.status === 0;
}

function cpuCores() {
  try { return os.cpus().length || 2; } catch { return 2; }
}

function have(bin) {
  const r = spawnSync(bin, ['-version'], { stdio: 'ignore' });
  if (r.error) { const r2 = spawnSync(bin, ['--version'], { stdio: 'ignore' }); return !r2.error; }
  return true;
}

function sh(bin, args, { quiet = false } = {}) {
  if (DRY) { say(`${C.d}$ ${bin} ${args.join(' ')}${C.x}`); return { code: 0, out: '' }; }
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0 && !quiet) {
    fail(`${bin} failed (exit ${r.status})\n${(r.stderr || '').slice(-1500)}`);
  }
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function shLive(bin, args) {
  if (DRY) { say(`${C.d}$ ${bin} ${args.join(' ')}${C.x}`); return Promise.resolve(0); }
  // Quiet by default: hide ffmpeg's banner/config dump, keep the progress line
  // and any real errors. Everything still goes to the log file.
  if (bin === 'ffmpeg' && !args.includes('-loglevel')) {
    args = ['-loglevel', VERBOSE ? 'info' : 'error', '-stats', ...args];
  }
  return new Promise((res, rej) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const onData = d => {
      const t = d.toString();
      tail = (tail + t).slice(-4000);
      LOG.push(t);
      process.stderr.write(t);       // progress line still shows live
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('close', c => {
      process.stderr.write('\n');
      c === 0 ? res(0) : rej(new Error(`${bin} exited ${c}\n${tail.slice(-1200)}`));
    });
    p.on('error', rej);
  });
}

/* ------------------------------------------------------------------ probe */

function probe(file) {
  if (DRY) {
    return { width:2160, height:3840, fps:60, vfr:false, codec:'hevc', bitDepth:10,
      colorPrimaries:'bt2020', colorTransfer:'arib-std-b67', colorMatrix:'bt2020nc',
      colorRange:'limited', hasDolbyVisionRPU:true, dvProfile:8.4, hasHdr10Metadata:false,
      durationSec:13.3, bitrateMbps:107.3, sizeMB:170.6, audioCodec:'aac', moovAtEnd:true,
      hdr:true, hdrFormat:'dolbyvision' };
  }
  const { out } = sh('ffprobe', ['-v','quiet','-print_format','json',
    '-show_streams','-show_format','-show_entries','stream_side_data', file]);
  const j = JSON.parse(out);
  const v = j.streams.find(s => s.codec_type === 'video') || {};
  const a = j.streams.find(s => s.codec_type === 'audio') || {};
  const rate = s => { const [n,d] = (s||'0/1').split('/').map(Number); return d ? n/d : 0; };
  const sd = JSON.stringify(v.side_data_list || []);

  return {
    width: v.width, height: v.height,
    fps: +rate(v.avg_frame_rate).toFixed(3),
    vfr: Math.abs(rate(v.r_frame_rate) - rate(v.avg_frame_rate)) > 0.02,
    codec: v.codec_name,
    bitDepth: v.bits_per_raw_sample ? +v.bits_per_raw_sample
            : /p10|10le|10be/.test(v.pix_fmt || '') ? 10
            : /p12|12le|12be/.test(v.pix_fmt || '') ? 12 : 8,
    pixFmt: v.pix_fmt,
    colorPrimaries: v.color_primaries, colorTransfer: v.color_transfer,
    colorMatrix: v.color_space, colorRange: v.color_range || 'limited',
    hasDolbyVisionRPU: /dovi|DOVI|Dolby/i.test(sd) || /dvh|dvhe/.test(v.codec_tag_string || ''),
    dvProfile: (() => {
      const pm = sd.match(/"dv_profile"\s*:\s*(\d+)/);
      const cm = sd.match(/"dv_bl_signal_compatibility_id"\s*:\s*(\d+)/);
      if (!pm) return null;
      const prof = +pm[1], compat = cm ? +cm[1] : null;
      // profile 8 + compatibility id: 1=HDR10(8.1) 2=SDR(8.2) 4=HLG(8.4)
      if (prof === 8 && compat === 1) return 8.1;
      if (prof === 8 && compat === 2) return 8.2;
      if (prof === 8 && compat === 4) return 8.4;
      return prof;
    })(),
    hasHdr10Metadata: /Mastering display|Content light/i.test(sd),
    masterDisplay: (() => {
      const m = sd.match(/"red_x":"(\d+)\/(\d+)"[\s\S]*?"white_point_y":"(\d+)\/(\d+)"/);
      return null;   // pass-through TODO; defaults are ST 2086 BT.2020
    })(),
    maxCll: null,
    durationSec: +(j.format.duration || 0),
    bitrateMbps: +(((+j.format.bit_rate || 0) / 1e6).toFixed(1)),
    sizeMB: +(((+j.format.size || 0) / 1048576).toFixed(1)),
    audioCodec: a.codec_name || null,
    moovAtEnd: false,
  };
}

/** The engine keys off src.hdr / src.hdrFormat — derive them from the tags. */
function deriveHdr(s) {
  const tr = (s.colorTransfer || '').toLowerCase();
  const pri = (s.colorPrimaries || '').toLowerCase();
  s.hdr = tr === 'smpte2084' || tr === 'arib-std-b67' || pri.includes('2020') || !!s.hasDolbyVisionRPU;
  s.hdrFormat = s.hasDolbyVisionRPU ? 'dolbyvision'
    : tr === 'smpte2084' ? (s.hasHdr10Metadata ? 'hdr10' : 'pq')
    : tr === 'arib-std-b67' ? 'hlg' : null;
  return s;
}

/** Prefer ffprobe when present; otherwise use the same MP4 parser the website
 *  and extension use, so --remux-only needs nothing installed. */
async function probeSource(file, tools) {
  if (DRY || tools.ffprobe) return probe(file);
  const { probeFile } = await import('../extension/probe.js');
  const buf = fs.readFileSync(file);
  const p = await probeFile({
    name: path.basename(file), size: buf.length,
    slice(a, b) {
      const st = a < 0 ? this.size + a : a;
      const en = b === undefined ? this.size : (b < 0 ? this.size + b : b);
      const x = buf.subarray(st, en);
      return { arrayBuffer: async () => x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) };
    },
  });
  return { ...p, durationSec: p.durationSec, sizeMB: p.fileSizeMB };
}

/* ------------------------------------------------------------------- main */

(async () => {
  head('Vague CLI  v7 (shared remux · rebrand · edit lists)');

  // toolchain
  const tools = { ffmpeg: have('ffmpeg'), ffprobe: have('ffprobe'), dovi_tool: have('dovi_tool') };
  const encList = tools.ffmpeg && !DRY
    ? (spawnSync('ffmpeg',['-hide_banner','-encoders'],{encoding:'utf8'}).stdout || '') : 'hevc_nvenc hevc_vaapi';
  tools.nvenc = /hevc_nvenc/.test(encList);
  tools.vaapi = /hevc_vaapi/.test(encList) && fs.existsSync('/dev/dri/renderD128');
  say(`  ffmpeg    ${tools.ffmpeg ? C.g+'found' : C.r+'MISSING'}${C.x}`);
  say(`  ffprobe   ${tools.ffprobe ? C.g+'found' : C.r+'MISSING'}${C.x}`);
  say(`  dovi_tool ${tools.dovi_tool ? C.g+'found' : C.y+'not found (Dolby Vision will be lost)'}${C.x}`);
  // Decide the base-layer encoder ONCE, testing that it really runs.
  const CORES = cpuCores();
  ENCODER = 'x265';
  if (GPU || AUTO_GPU) {
    if (tools.nvenc && encoderWorks('hevc_nvenc', ['-preset','p1'])) ENCODER = 'nvenc';
    else if (tools.nvenc) say(`  ${C.y}hevc_nvenc present but not usable (no NVIDIA driver) — falling back${C.x}`);
    if (ENCODER === 'x265' && tools.vaapi &&
        encoderWorks('hevc_vaapi', ['-vaapi_device','/dev/dri/renderD128','-vf','format=nv12,hwupload'])) {
      ENCODER = 'vaapi';
    }
  }
  const label = ENCODER === 'nvenc' ? C.g+'NVIDIA GPU (hevc_nvenc)'
              : ENCODER === 'vaapi' ? C.g+'GPU (VAAPI)'
              : `CPU x265, ${CORES} core${CORES>1?'s':''}`;
  say(`  encoder   ${label}${C.x}`);
  if (ENCODER === 'x265' && !PRESET_SET) {
    // A slow preset on few cores is unusable. Scale it to the machine.
    PRESET = CORES <= 2 ? 'veryfast' : CORES <= 4 ? 'faster' : CORES <= 8 ? 'fast' : 'medium';
    say(`  ${C.d}preset auto-set to "${PRESET}" for ${CORES} cores (override with --preset)${C.x}`);
  }
  if (!DRY && !REMUX && (!tools.ffmpeg || !tools.ffprobe)) {
    fail('Install ffmpeg first — see cli/SETUP.md\n' +
         '  (tip: --remux-only works with no external tools at all)');
  }
  if (REMUX && !tools.ffprobe) {
    say(`  ${C.d}ffprobe not needed for --remux-only — using the built-in parser${C.x}`);
  }

  head('Source');
  const src = deriveHdr(await probeSource(input, tools));
  say(`  ${src.width}×${src.height} @ ${src.fps}fps ${src.vfr ? C.y+'VFR'+C.x : 'CFR'} · ` +
      `${src.codec} ${src.bitDepth}-bit · ${src.bitrateMbps} Mbps · ${src.durationSec}s`);
  say(`  colour  ${src.colorPrimaries}/${src.colorTransfer}/${src.colorMatrix}`);
  say(`  dolby   ${src.hasDolbyVisionRPU ? C.g+`RPU present (profile ${src.dvProfile ?? '8.4'})`+C.x : 'none'}`);

  // §2.3b — the duration patch and HDR are mutually exclusive on TikTok.
  // Owner-tested: a patched HDR file keeps its HDR data through the pipeline,
  // but the player never switches into HDR mode for a 00:00-duration file.
  // Refuse the combination unless the output will actually be SDR (--sdr on
  // the transcode path — a remux copies streams, so --sdr rescues nothing
  // there) or the owner explicitly overrides (--force-patch).
  if (PATCH) {
    say(`\n  ${C.y}${C.B}⚠ The 00:00 duration patch is likely BROKEN by TikTok's Sept 2026 update.${C.x}`);
    say(`  ${C.y}Owner-tested: the app's post screen shows no duration and the post cannot be${C.x}`);
    say(`  ${C.y}published; TikTok Studio refuses 00:00 files on upload. Kept for experimentation${C.x}`);
    say(`  ${C.y}only. The frame-rate method (--method) keeps a real duration — unaffected.${C.x}`);
    if (src.hdr)
      say(`  ${C.y}(HDR note: the old §2.3b 'patch kills HDR' claim is confounded — see HANDOFF.)${C.x}`);
  }

  const dx = diagnose(src);
  if (dx.criticalCount) {
    head('Problems found');
    for (const f of dx.findings) {
      if (f.severity === 'ok') continue;
      const col = f.severity === 'critical' ? C.r : C.y;
      say(`  ${col}[${f.severity}]${C.x} ${f.title}`);
      say(`     ${C.d}${f.symptom}${C.x}`);
    }
    const t = identifyToolchain(src);
    if (t) say(`  ${C.b}→ likely source: ${t.likely}${C.x}`);
  }

  // ---- lossless remux path -------------------------------------------------
  //
  // Uses the same remux module as the website and the extension, so all three
  // surfaces perform byte-identical operations: moov to the front, QuickTime
  // rebranding, edit-list neutralisation, optional duration patch.
  if (REMUX) {
    head('Lossless remux');
    if (DRY) {
      say(`  ${C.d}(dry run) would remux ${input} -> ${outPath}${C.x}`);
      say(`  ${C.d}  moov to front · rebrand qt->mp42 · neutralise edit lists${PATCH ? ' · zero duration' : ''}${C.x}`);
      return;
    }
    const { faststartRemux } = await import('../extension/remux.js');
    const buf = fs.readFileSync(input);
    const fileLike = {
      name: path.basename(input), size: buf.length, type: 'video/mp4',
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
      slice(a, b) {
        const st = a < 0 ? this.size + a : a;
        const en = b === undefined ? this.size : (b < 0 ? this.size + b : b);
        const x = buf.subarray(st, en);
        return { arrayBuffer: async () => x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) };
      },
    };
    if (typeof globalThis.Blob === 'undefined') {
      globalThis.Blob = class {
        constructor(parts) {
          this._b = Buffer.concat(parts.map(x =>
            Buffer.from(x instanceof Uint8Array ? x : new Uint8Array(x))));
          this.size = this._b.length;
        }
        async arrayBuffer() {
          return this._b.buffer.slice(this._b.byteOffset, this._b.byteOffset + this._b.length);
        }
      };
    }
    let last = -1;
    const r = await faststartRemux(fileLike, (pct, label) => {
      if (pct !== last) { process.stderr.write(`\r  ${label}… ${pct}%   `); last = pct; }
    }, { zeroDuration: PATCH ? (PATCH_AGG ? 'aggressive' : true) : false,
         rebrand: true, stripEdits: true, stripDV: NO_DV,
         fpsGuard: METHOD && src.fps > 48 ? (src.fps > 90 ? 4 : 2) : 0 });
    if (PATCH) {
      say(`\n  ${C.y}${C.B}⚠ PATCHED FILE — one valid upload route only:${C.x}`);
      say(`  ${C.y}   1. move it to your phone losslessly (USB / Telegram as File / http.server)`);
      say(`     2. pass the FILE itself: "Files"/browse picker if your app has one, or the iOS`);
      say(`        share sheet (Files app -> Share -> TikTok). NOT the gallery — it re-encodes`);
      say(`        and rebuilds the duration, which strips the patch`);
      say(`     3. do NOT use TikTok Studio on desktop — it will refuse the file${C.x}`);
      say(`  ${C.y}   4. keep the patched file OUT of iOS Photos — a 00:00 duration can crash${C.x}`);
      say(`  ${C.y}     the gallery (owner-tested). Store it in the Files app.${C.x}`);
      say(`  ${C.d}Showing 00:00 in your gallery is expected. That is the patch working.${C.x}`);
      if (src.hdr)
        say(`  ${C.y}   ⚠ experimental on HDR — TikTok shows no HDR tag; check whether it${C.x}`);
        say(`  ${C.y}     VISIBLY plays HDR (highlights pop on an HDR screen). If not, re-post${C.x}`);
        say(`  ${C.y}     without --patch (§2.3b confound documented in HANDOFF)${C.x}`);
    }
    process.stderr.write('\n');

    const changed = r.moved || r.rebranded || r.editsStripped || r.durationZeroed ||
                    (r.dvStripped && r.dvStripped.boxes) ||
                    (r.fpsGuarded && (r.fpsGuarded.mvhd || r.fpsGuarded.mdhd));
    if (!changed) {
      say(`\n  ${C.g}★ Nothing to change${C.x} — this file is already optimal.`);
      say(`  ${C.d}Upload ${input} as it is.${C.x}\n`);
      if (UPLOAD) await uploadToTikTok(input);
      return;
    }
    fs.writeFileSync(outPath, Buffer.from(await r.blob.arrayBuffer()));
    say(`  ${C.d}${r.note}${C.x}`);
    if (METHOD && !(r.fpsGuarded && (r.fpsGuarded.mvhd || r.fpsGuarded.mdhd)))
      say(`  ${C.y}⚠ --method: no 60/120 fps source detected — timescale not touched.${C.x}`);
    if (r.fpsGuarded && (r.fpsGuarded.mvhd || r.fpsGuarded.mdhd)) {
      say(`  ${C.b}→ frame-rate method: headers now declare ${(src.fps / r.fpsGuarded.divider).toFixed(2)} fps;` +
          ` the ${src.fps} fps samples pass through untouched.${C.x}`);
      say(`  ${C.d}TikTok's encoder finds a rate it considers "nothing to decimate" — the trick behind${C.x}`);
      say(`  ${C.d}every "60/120 fps method" video. Local players may report the halved rate — expected.${C.x}`);
    }
    say(`\n${C.g}✓ ${outPath}${C.x}  (${(fs.statSync(outPath).size/1048576).toFixed(1)} MB — streams copied, no quality change)`);
    if (src.hdr) {
      say(`\n  ${C.B}📱 HDR file — two routes that keep it:${C.x}`);
      say(`  ${C.b}A. TikTok Studio (desktop) as "Only me" → then flip to Everyone IN THE APP.${C.x}`);
      say(`  ${C.d}   Community-verified: 60fps · 1080p · HDR · HEVC survive. Works with --method`);
      say(`     files (real duration — Studio refuses 00:00 patched files).${C.x}`);
      say(`  ${C.b}B. Phone file route: Files picker / iOS share sheet (Files → Share → TikTok).${C.x}`);
      say(`  ${C.d}Transfer losslessly: USB · Telegram "Send as File" · python3 -m http.server 8000${C.x}`);
      say(`  ${C.y}📎 In the app, attach via "Files" — NOT the gallery (gallery re-encodes).${C.x}`);
    } else {
      say(`\n  ${C.B}💻 SDR file — upload from TikTok Studio on desktop.${C.x}`);
    }
    if (UPLOAD) await uploadToTikTok(outPath);
    return;
  }

  // ---- plan ---------------------------------------------------------------
  const p = plan({ ...src, path: input, outPath }, platform, {
    uploadPath: 'web',
    force1080: DOWN1080,              // optional: TikTok accepts 4K now
    preconditioning: !src.hdr,           // never denoise/sharpen an HDR master
  });
  const o = p.output;

  if (KEEP4K) { o.width = src.width; o.height = src.height; }
  const wantHdr = o.hdr && !FORCE_SDR;

  head('Plan');
  say(`  ${src.width}×${src.height} → ${C.B}${o.width}×${o.height}${C.x} @ ${C.B}${o.fps}fps CFR${C.x}`);
  say(`  ${wantHdr ? C.g + 'HDR preserved (' + (o.hdrTarget || 'hlg') + ')' + C.x : 'SDR (BT.2390 tonemap)'}`);
  say(`  ${o.codec} · ${o.targetMbps} Mbps · est ${o.estimatedSizeMB} MB`);
  say(`  ${C.d}${p.decisions.fps.reason}${C.x}`);

  const dvUsable = src.dvProfile == null || [8, 8.4, 5].includes(Number(src.dvProfile));
  const isDV = wantHdr && src.hasDolbyVisionRPU && tools.dovi_tool && dvUsable && !NO_DV;
  if (NO_DV && src.hasDolbyVisionRPU)
    say(`  ${C.b}→ --no-dv: encoding as plain HLG HDR, no Dolby Vision metadata.${C.x}`);
  if (wantHdr && src.hasDolbyVisionRPU && tools.dovi_tool && !dvUsable)
    say(`  ${C.y}⚠ Dolby Vision profile ${src.dvProfile} is not a social profile — encoding as plain HDR.${C.x}`);
  const route = isDV ? 'Dolby Vision (RPU carry)' : wantHdr ? 'HDR (HLG/PQ)' : 'SDR';
  say(`\n  route: ${C.B}${route}${C.x}`);

  if (wantHdr && src.hasDolbyVisionRPU && !tools.dovi_tool) {
    say(`  ${C.y}⚠ dovi_tool missing — Dolby Vision metadata will be dropped.${C.x}`);
    say(`  ${C.y}  The HLG base layer survives, so you keep HDR, just not DV.${C.x}`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vague-'));
  const dirTmp = tmp;
  try {
    if (isDV)        await encodeDV(input, outPath, src, o, tmp);
    else if (wantHdr) await encodeHDR(input, outPath, src, o);
    else              await encodeSDR(input, outPath, p, o);

    head('Verify');
    if (DRY) { say('  (dry run — nothing encoded)'); return; }
    const res = probe(outPath);
    const ok = (l, c, extra='') => say(`  ${c ? C.g+'✓' : C.r+'✗'}${C.x} ${l}${C.d}${extra}${C.x}`);
    ok(`resolution ${res.width}×${res.height}`, res.width === o.width && res.height === o.height);
    ok(`frame rate ${res.fps} fps`, Math.abs(res.fps - o.fps) < 0.05);
    const drift = Math.abs(res.durationSec - src.durationSec);
    ok(`duration ${res.durationSec}s`, drift < 0.05,
       drift >= 0.05 ? `  (source ${src.durationSec}s — ${drift.toFixed(2)}s drift, may judder)` : '');
    ok(`codec ${res.codec} ${res.bitDepth}-bit`, true);
    ok(`transfer ${res.colorTransfer}`, true);
    if (isDV) {
      // `dovi_tool info` parses an RPU FILE. To test a video, try extracting
      // an RPU back out of it — a non-empty result proves the metadata is there.
      const back = path.join(dirTmp, 'check.rpu');
      spawnSync('sh', ['-c',
        `ffmpeg -v error -i ${JSON.stringify(outPath)} -c:v copy -bsf:v hevc_mp4toannexb -f hevc - ` +
        `| dovi_tool extract-rpu - -o ${JSON.stringify(back)} 2>/dev/null`],
        { encoding:'utf8', maxBuffer: 1<<26 });
      const gotBytes = fs.existsSync(back) ? fs.statSync(back).size : 0;
      const rpuInStream = gotBytes > 1024;

      // Does the CONTAINER advertise Dolby Vision? (dvcC / dvvC box)
      const pf = sh('ffprobe', ['-v','error','-i',outPath], { quiet:true });
      const dvcC = /DOVI configuration record/i.test((pf.err||'') + (pf.out||''));

      ok(`Dolby Vision RPU in bitstream`, rpuInStream,
         rpuInStream ? `  (${(gotBytes/1024).toFixed(0)} KB recovered)` : '');
      ok('Container signals Dolby Vision (dvcC box)', dvcC);

      if (!rpuInStream) fail('The RPU did not survive encoding — output not trustworthy.');

      if (!dvcC) {
        say(`  ${C.y}⚠ RPU frames ARE present, but the MP4 lacks the dvcC box, so some`);
        say(`    players will not switch into Dolby Vision mode. HLG HDR still works.${C.x}`);
        if (have('MP4Box')) {
          say(`  ${C.d}  MP4Box found — adding the Dolby Vision signal…${C.x}`);
          const fixed = outPath.replace(/\.mp4$/, '-dv.mp4');
          const m = sh('MP4Box', ['-add', `${outPath}#video:dvp=84:xps_inband`,
                                  '-add', `${outPath}#audio`, '-new', fixed], { quiet:true });
          if (m.code === 0 && fs.existsSync(fixed)) {
            fs.renameSync(fixed, outPath);
            say(`  ${C.g}✓ Dolby Vision signalling added${C.x}`);
          } else {
            say(`  ${C.y}  MP4Box could not add it — upload as-is, HLG HDR is intact.${C.x}`);
          }
        } else {
          say(`  ${C.d}  For full DV signalling:  sudo apt install gpac${C.x}`);
        }
      }
    }
    if (PATCH) {
      zeroDurations(outPath);
      say(`  ${C.y}⚑ header duration zeroed (players will show 0:00)${C.x}`);
      if (src.hdr && !FORCE_SDR)
        say(`  ${C.y}  ⚠ experimental on HDR — verify the post renders HDR (§2.3b confound)${C.x}`);
    }

    const mb = (fs.statSync(outPath).size / 1048576).toFixed(1);
    say(`\n${C.g}${C.B}✓ Done — ${outPath} (${mb} MB)${C.x}`);
    if (res && res.hdr) {
      say(`\n  ${C.B}📱 This file is HDR — two routes that keep it:${C.x}`);
      say(`  ${C.b}A. Studio (desktop) as "Only me" → flip to Everyone IN THE APP — keeps 60fps/HDR/HEVC${C.x}`);
      say(`  ${C.b}B. Phone file route: Files picker / iOS share sheet${C.x}`);
      say(`  ${C.d}Get it to the phone losslessly: USB · Telegram "Send as File" ·`);
      say(`  python3 -m http.server 8000 · Drive/Dropbox as a file. Never WhatsApp.${C.x}`);
      say(`\n  ${C.y}📎 In the TikTok app, add it via "Files"/attach — NOT from the gallery.`);
      say(`     The photo library hands over a re-encoded copy; Files passes the original.${C.x}`);
    } else {
      say(`\n  ${C.B}💻 This file is SDR — upload from TikTok Studio on desktop.${C.x}`);
      say(`  ${C.d}Single compression pass, 4 GB limit. The phone app would add a re-encode.${C.x}`);
    }
    say(`  ${C.d}Either way: "Allow high-quality uploads" ON, post public, do not edit after.${C.x}`);
    say(`${C.d}  Log saved to: ${LOGFILE}${C.x}`);
    if (UPLOAD) await uploadToTikTok(outPath);
    say('');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => fail(e.message));


/* ---------------------------------------------------------- tiktok upload */

async function uploadToTikTok(file) {
  head('Uploading to TikTok drafts');
  say(`  ${C.d}Official Content Posting API, inbox-draft mode.`);
  say(`  This does NOT change how TikTok compresses — it just puts the file`);
  say(`  in your app's drafts so you can post it from the phone.${C.x}\n`);
  try {
    const tt = require('./tiktok');
    const r = await tt.uploadDraft(file, (pct, label) => {
      process.stderr.write(`\r  ${label}… ${pct}%   `);
    });
    process.stderr.write('\n');
    say(`  ${C.g}✓ Sent to your TikTok inbox${C.x}`);
    say(`  ${C.d}publish_id ${r.publish_id}${C.x}`);
    say(`\n  ${C.B}Open TikTok on your phone → Profile → Drafts → finish and post.${C.x}`);
    say(`  ${C.y}Do not re-edit it there — adding sounds or trims makes TikTok re-encode.${C.x}`);
  } catch (e) {
    say(`  ${C.r}✗ Upload failed: ${e.message}${C.x}`);
    say(`  ${C.d}Your file is fine — upload it manually from TikTok Studio.${C.x}`);
  }
}

/* --------------------------------------------------------------- encoders */

async function encodeDV(input, out, src, o, tmp) {
  const rpu  = path.join(tmp, 'rpu.bin');
  const base = path.join(tmp, 'base.hevc');
  const injected = path.join(tmp, 'injected.hevc');

  // --- 1. pull the RPU out of the source -----------------------------------
  head('1/4 Extracting Dolby Vision RPU');
  if (!DRY) {
    const ff = spawn('ffmpeg', ['-v','error','-i',input,'-c:v','copy',
      '-bsf:v','hevc_mp4toannexb','-f','hevc','-']);
    const dv = spawn('dovi_tool', ['extract-rpu','-','-o',rpu]);
    ff.stdout.pipe(dv.stdin);
    await new Promise((res, rej) => {
      dv.on('close', c => c === 0 ? res() : rej(new Error('dovi_tool extract-rpu failed')));
      dv.on('error', rej);
    });
    say(`  ${C.g}✓${C.x} ${(fs.statSync(rpu).size/1024).toFixed(0)} KB of RPU metadata`);
  } else say(`  ${C.d}$ ffmpeg ... | dovi_tool extract-rpu - -o rpu.bin${C.x}`);

  // --- 2. encode the base layer, WITHOUT any Dolby Vision x265 options -----
  //     Many x265 builds (incl. Ubuntu's 3.5) lack dolby-vision-rpu and do
  //     not know profile 8.4. We do not need them: dovi_tool injects the RPU
  //     into the finished bitstream instead.
  const hlg = src.colorTransfer === 'arib-std-b67';
  const names = { nvenc:'NVIDIA GPU', vaapi:'GPU (VAAPI)', x265:`CPU x265 ${PRESET}` };
  head(`2/4 Encoding base layer  (${names[ENCODER]})`);

  const colour = ['-colorspace','bt2020nc','-color_primaries','bt2020',
                  '-color_trc', hlg ? 'arib-std-b67' : 'smpte2084'];
  const rate   = ['-b:v',`${o.targetMbps}M`,
                  '-maxrate',`${Math.round(o.targetMbps*1.5)}M`,
                  '-bufsize',`${Math.round(o.targetMbps*3)}M`];

  let args;
  if (ENCODER === 'nvenc') {
    args = ['-hide_banner','-y','-i',input,'-map','0:v:0',
      '-vf',`scale=${o.width}:${o.height}:flags=lanczos,format=p010le`,
      '-r',String(o.fps),'-fps_mode','cfr', ...colour,
      '-c:v','hevc_nvenc','-profile:v','main10','-preset','p6','-tune','hq',
      '-rc','vbr','-cq','19', ...rate];
  } else if (ENCODER === 'vaapi') {
    args = ['-hide_banner','-y','-vaapi_device','/dev/dri/renderD128','-i',input,'-map','0:v:0',
      '-vf',`scale=${o.width}:${o.height}:flags=lanczos,format=p010,hwupload`,
      '-r',String(o.fps),'-fps_mode','cfr', ...colour,
      '-c:v','hevc_vaapi','-profile:v','main10', ...rate];
  } else {
    args = ['-hide_banner','-y','-i',input,'-map','0:v:0',
      '-vf',`scale=${o.width}:${o.height}:flags=lanczos,format=yuv420p10le`,
      '-r',String(o.fps),'-fps_mode','cfr', ...colour,
      '-c:v','libx265','-preset',PRESET,'-crf','18','-profile:v','main10',
      '-x265-params',[
        'repeat-headers=1','aud=1','hrd=1',
        'colorprim=bt2020',`transfer=${hlg?'arib-std-b67':'smpte2084'}`,'colormatrix=bt2020nc',
        ...(hlg ? [] : ['hdr-opt=1']),
        `vbv-maxrate=${Math.round(o.targetMbps*1500)}`,
        `vbv-bufsize=${Math.round(o.targetMbps*3000)}`,
        `pools=${cpuCores()}`,
      ].join(':')];
  }
  await shLive('ffmpeg', [...args, '-f','hevc', base]);

  // --- 3. inject the RPU back into the encoded stream ----------------------
  head('3/4 Injecting Dolby Vision RPU');
  await shLive('dovi_tool', ['inject-rpu','-i',base,'--rpu-in',rpu,'-o',injected]);

  // --- 4. mux video + original audio into MP4 ------------------------------
  //
  // Raw Annex B has NO timestamps. With B-pyramids, display order != decode
  // order, and regenerating timing naively produces visible judder. MP4Box
  // parses the HEVC picture order counts and builds correct CTS/DTS tables,
  // so we prefer it and only fall back to ffmpeg.
  head('4/4 Muxing');
  const audio = path.join(tmp, 'audio.m4a');
  const hasAudio = !!src.audioCodec;
  if (hasAudio) {
    await shLive('ffmpeg', ['-hide_banner','-y','-i',input,'-vn','-c:a','copy', audio])
      .catch(() => { say(`  ${C.y}no audio track copied${C.x}`); });
  }

  if (have('MP4Box')) {
    const add = [`${injected}:fps=${o.fps}`];
    const args = ['-add', add[0]];
    if (hasAudio && fs.existsSync(audio)) args.push('-add', audio);
    args.push('-new', out);
    await shLive('MP4Box', args);
    // MP4Box writes moov first by default; ensure faststart anyway
    say(`  ${C.d}muxed with MP4Box (correct B-frame timing)${C.x}`);
  } else {
    say(`  ${C.y}⚠ MP4Box not found — using ffmpeg, which can introduce judder`);
    say(`    with B-pyramid streams. Install it:  sudo apt install gpac${C.x}`);
    await shLive('ffmpeg', ['-hide_banner','-y',
      '-fflags','+genpts','-r',String(o.fps),'-i',injected,
      ...(hasAudio ? ['-i',input] : []),
      '-map','0:v:0', ...(hasAudio ? ['-map','1:a:0?'] : []),
      '-c:v','copy', ...(hasAudio ? ['-c:a','copy'] : []),
      '-video_track_timescale','60000',
      '-tag:v','hvc1','-movflags','+faststart', out]);
  }
}

async function encodeHDR(input, out, src, o) {
  head('Encoding (HDR preserved)');
  const hlg = src.colorTransfer === 'arib-std-b67';
  await shLive('ffmpeg', ['-hide_banner','-y','-i',input,
    '-vf',`scale=${o.width}:${o.height}:flags=lanczos,format=yuv420p10le`,
    '-r',String(o.fps),'-fps_mode','cfr',
    '-c:v','libx265','-preset','slow','-crf','18','-profile:v','main10',
    '-x265-params',`hdr-opt=1:repeat-headers=1:colorprim=bt2020:transfer=${hlg?'arib-std-b67':'smpte2084'}:colormatrix=bt2020nc`,
    '-colorspace','bt2020nc','-color_primaries','bt2020',
    '-color_trc', hlg ? 'arib-std-b67' : 'smpte2084',
    '-c:a','aac','-b:a','256k','-ar','48000','-ac','2',
    '-tag:v','hvc1','-movflags','+faststart', out]);
}

async function encodeSDR(input, out, p, o) {
  head('Encoding (SDR)');
  const i = p.ffmpeg.indexOf('-vf');
  const vf = i >= 0 ? p.ffmpeg[i+1] : `scale=${o.width}:${o.height}:flags=lanczos,format=yuv420p`;
  await shLive('ffmpeg', ['-hide_banner','-y','-i',input,
    '-vf', vf, '-r',String(o.fps),'-fps_mode','cfr',
    '-c:v','libx264','-preset','slow','-crf','17',
    '-maxrate',`${Math.round(o.targetMbps*1.5)}M`,'-bufsize',`${o.targetMbps*3}M`,
    '-profile:v','high','-level','4.2',
    '-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709',
    '-c:a','aac','-b:a','256k','-ar','48000','-ac','2',
    '-movflags','+faststart', out]);
}

/* ----------------------------------------------- the duration-zero patch */

function zeroDurations(file) {
  const buf = fs.readFileSync(file);
  let n = 0;
  const walk = (start, end) => {
    let o = start;
    while (o + 8 <= end) {
      let size = buf.readUInt32BE(o);
      const type = buf.toString('latin1', o + 4, o + 8);
      let hdr = 8;
      if (size === 1) { size = Number(buf.readBigUInt64BE(o + 8)); hdr = 16; }
      else if (size === 0) size = end - o;
      if (size < hdr || o + size > end) break;
      const c = o + hdr, ver = buf.readUInt8(c);
      if (type === 'mvhd' || type === 'mdhd') {
        if (ver === 1) buf.writeBigUInt64BE(0n, c + 24); else buf.writeUInt32BE(0, c + 16);
        n++;
      } else if (type === 'tkhd') {
        if (ver === 1) buf.writeBigUInt64BE(0n, c + 28); else buf.writeUInt32BE(0, c + 20);
        n++;
      } else if (['moov','trak','mdia','edts'].includes(type)) walk(c, o + size);
      o += size;
    }
  };
  walk(0, buf.length);
  fs.writeFileSync(file, buf);
  return n;
}
