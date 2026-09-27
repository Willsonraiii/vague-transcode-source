#!/usr/bin/env node
/**
 * Vague — local desktop app.
 *
 * Serves a real UI on 127.0.0.1 and opens it in your browser. Same engine as
 * the CLI, but you drop a file on a window instead of typing commands.
 * Nothing leaves your machine; the server only listens on loopback.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync, execFile } = require('child_process');
const { plan } = require('../core/profiles');
const { diagnose, identifyToolchain } = require('../core/hdr-doctor');

const PORT = process.env.VAGUE_PORT ? +process.env.VAGUE_PORT : 4777;
const HOST = process.env.VAGUE_HOST || '127.0.0.1';
const jobs = new Map();

/* ------------------------------------------------------------- toolchain */

function have(bin) {
  const r = spawnSync(bin, ['-version'], { stdio: 'ignore' });
  if (r.error) return !spawnSync(bin, ['--version'], { stdio: 'ignore' }).error;
  return true;
}
const TOOLS = { ffmpeg: have('ffmpeg'), ffprobe: have('ffprobe'), dovi_tool: have('dovi_tool') };

/* ----------------------------------------------------------------- probe */

function deriveHdr(s) {
  const tr = (s.colorTransfer || '').toLowerCase();
  const pri = (s.colorPrimaries || '').toLowerCase();
  s.hdr = tr === 'smpte2084' || tr === 'arib-std-b67' || pri.includes('2020') || !!s.hasDolbyVisionRPU;
  s.hdrFormat = s.hasDolbyVisionRPU ? 'dolbyvision'
    : tr === 'smpte2084' ? (s.hasHdr10Metadata ? 'hdr10' : 'pq')
    : tr === 'arib-std-b67' ? 'hlg' : null;
  return s;
}

function probe(file) {
  const r = spawnSync('ffprobe', ['-v','quiet','-print_format','json',
    '-show_streams','-show_format', file], { encoding:'utf8', maxBuffer: 1<<28 });
  if (r.status !== 0) throw new Error('ffprobe could not read this file.');
  const j = JSON.parse(r.stdout);
  const v = j.streams.find(s => s.codec_type === 'video') || {};
  const a = j.streams.find(s => s.codec_type === 'audio') || {};
  const rate = s => { const [n,d] = (s||'0/1').split('/').map(Number); return d ? n/d : 0; };
  const sd = JSON.stringify(v.side_data_list || []);
  return deriveHdr({
    width: v.width, height: v.height,
    fps: +rate(v.avg_frame_rate).toFixed(3),
    vfr: Math.abs(rate(v.r_frame_rate) - rate(v.avg_frame_rate)) > 0.02,
    codec: v.codec_name, bitDepth: v.bits_per_raw_sample ? +v.bits_per_raw_sample : 8,
    colorPrimaries: v.color_primaries, colorTransfer: v.color_transfer,
    colorMatrix: v.color_space, colorRange: v.color_range || 'limited',
    hasDolbyVisionRPU: /dovi|DOVI|Dolby/i.test(sd) || /dvh/.test(v.codec_tag_string||''),
    dvProfile: (() => {
      const m = sd.match(/"dv_profile"\s*:\s*(\d+)/);
      if (!m) return null;
      const n = +m[1];
      // profile 8 is reported without the .x sub-profile; 8.4 is the social one
      return n === 8 ? 8.4 : n;
    })(),
    hasHdr10Metadata: /Mastering|Content light/i.test(sd),
    durationSec: +(j.format.duration||0),
    bitrateMbps: +(((+j.format.bit_rate||0)/1e6).toFixed(1)),
    sizeMB: +(((+j.format.size||0)/1048576).toFixed(1)),
    audioCodec: a.codec_name || null, moovAtEnd: false,
  });
}

/* ---------------------------------------------------------------- encode */

function zeroDurations(file) {
  const buf = fs.readFileSync(file);
  const walk = (start, end) => {
    let o = start;
    while (o + 8 <= end) {
      let size = buf.readUInt32BE(o);
      const type = buf.toString('latin1', o+4, o+8);
      let hdr = 8;
      if (size === 1) { size = Number(buf.readBigUInt64BE(o+8)); hdr = 16; }
      else if (size === 0) size = end - o;
      if (size < hdr || o + size > end) break;
      const c = o + hdr, ver = buf.readUInt8(c);
      if (type === 'mvhd' || type === 'mdhd') {
        if (ver === 1) buf.writeBigUInt64BE(0n, c+24); else buf.writeUInt32BE(0, c+16);
      } else if (type === 'tkhd') {
        if (ver === 1) buf.writeBigUInt64BE(0n, c+28); else buf.writeUInt32BE(0, c+20);
      } else if (['moov','trak','mdia','edts'].includes(type)) walk(c, o+size);
      o += size;
    }
  };
  walk(0, buf.length);
  fs.writeFileSync(file, buf);
}

function runJob(id, input, o) {
  const job = jobs.get(id);
  const src = job.src, p = job.plan, out = job.out;
  const log = m => { job.log.push(m); if (job.log.length > 400) job.log.shift(); };

  const done = (ok, msg) => { job.state = ok ? 'done' : 'error'; job.message = msg; job.pct = ok ? 100 : job.pct; };

  const ffargs = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vague-'));
  const isDV = o.hdr && src.hasDolbyVisionRPU && TOOLS.dovi_tool && !o.forceSdr;

  const finish = () => {
    try {
      if (o.patch) { zeroDurations(out); log('Header duration zeroed (players show 0:00).'); }
      const res = probe(out);
      job.result = res;
      let warn = '';
      if (Math.abs(res.fps - p.output.fps) > 0.5) warn += ` ⚠ fps came out ${res.fps}.`;
      if (isDV) {
        const dv = spawnSync('dovi_tool', ['info','-i',out,'-f','0'], { encoding:'utf8' });
        if (!/profile[^\d]*8/i.test(dv.stdout||'')) {
          return done(false, 'Dolby Vision was LOST during encoding — output not trustworthy.');
        }
        log('✓ Dolby Vision RPU verified in output.');
      }
      done(true, `Done — ${(fs.statSync(out).size/1048576).toFixed(1)} MB.${warn}`);
    } catch (e) { done(false, e.message); }
    finally { fs.rmSync(tmp, { recursive:true, force:true }); }
  };

  /* --- remux only ------------------------------------------------------- */
  if (o.mode === 'remux') {
    job.state = 'running'; job.stage = 'Copying streams (lossless)';
    const ff = spawn('ffmpeg', ['-hide_banner','-y','-i',input,'-c','copy','-movflags','+faststart',out]);
    ff.stderr.on('data', d => log(d.toString().trim()));
    ff.on('close', c => c === 0 ? finish() : done(false, 'ffmpeg failed during remux.'));
    return;
  }

  /* --- full encode ------------------------------------------------------ */
  const go = (rpuPath) => {
    job.stage = isDV ? 'Encoding (Dolby Vision)' : o.hdr ? 'Encoding (HDR)' : 'Encoding (SDR)';
    const op = p.output;
    let args;
    if (isDV || o.hdr) {
      const hlg = src.colorTransfer === 'arib-std-b67';
      const x265 = ['hdr-opt=1','repeat-headers=1','colorprim=bt2020',
        `transfer=${hlg?'arib-std-b67':'smpte2084'}`,'colormatrix=bt2020nc',
        // x265 requires vbv + aud + hrd whenever a DV profile is set
        ...(rpuPath ? [`dolby-vision-rpu=${rpuPath}`,'dolby-vision-profile=8.4','aud=1','hrd=1',
             'master-display=G(8500,39850)B(6550,2300)R(35400,14600)WP(15635,16450)L(10000000,1)','max-cll=1000,400'] : []),
        `vbv-maxrate=${Math.round(op.targetMbps*1500)}`,
        `vbv-bufsize=${Math.round(op.targetMbps*3000)}`].join(':');
      args = ['-hide_banner','-y','-i',input,
        '-vf',`scale=${op.width}:${op.height}:flags=lanczos,format=yuv420p10le`,
        '-r',String(op.fps),'-fps_mode','cfr',
        '-c:v','libx265','-preset',o.preset||'slow','-crf','18','-profile:v','main10',
        '-x265-params',x265,
        '-colorspace','bt2020nc','-color_primaries','bt2020',
        '-color_trc', hlg?'arib-std-b67':'smpte2084',
        '-c:a','aac','-b:a','256k','-ar','48000','-ac','2',
        '-tag:v','hvc1','-movflags','+faststart',out];
    } else {
      const i = p.ffmpeg.indexOf('-vf');
      const vf = i>=0 ? p.ffmpeg[i+1] : `scale=${op.width}:${op.height}:flags=lanczos,format=yuv420p`;
      args = ['-hide_banner','-y','-i',input,'-vf',vf,
        '-r',String(op.fps),'-fps_mode','cfr',
        '-c:v','libx264','-preset',o.preset||'slow','-crf','17',
        '-maxrate',`${Math.round(op.targetMbps*1.5)}M`,'-bufsize',`${op.targetMbps*3}M`,
        '-profile:v','high','-level','4.2',
        '-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709',
        '-c:a','aac','-b:a','256k','-ar','48000','-ac','2','-movflags','+faststart',out];
    }
    const ff = spawn('ffmpeg', args);
    ff.stderr.on('data', d => {
      const s = d.toString();
      const m = s.match(/time=(\d+):(\d+):([\d.]+)/);
      if (m && src.durationSec) {
        const sec = +m[1]*3600 + +m[2]*60 + parseFloat(m[3]);
        job.pct = Math.min(99, Math.round(sec / src.durationSec * 100));
      }
      const sp = s.match(/speed=\s*([\d.]+)x/); if (sp) job.speed = sp[1] + 'x';
      log(s.trim());
    });
    ff.on('close', c => c === 0 ? finish() : done(false, 'ffmpeg failed — see the log.'));
  };

  job.state = 'running';
  if (isDV) {
    job.stage = 'Extracting Dolby Vision RPU';
    const rpu = path.join(tmp, 'rpu.bin');
    const ff = spawn('ffmpeg', ['-v','error','-i',input,'-c:v','copy','-bsf:v','hevc_mp4toannexb','-f','hevc','-']);
    const dv = spawn('dovi_tool', ['extract-rpu','-','-o',rpu]);
    ff.stdout.pipe(dv.stdin);
    dv.on('close', c => {
      if (c !== 0 || !fs.existsSync(rpu) || fs.statSync(rpu).size === 0) {
        log('No RPU extracted — continuing as plain HDR.');
        return go(null);
      }
      log(`✓ RPU extracted (${(fs.statSync(rpu).size/1024).toFixed(0)} KB)`);
      go(rpu);
    });
    dv.on('error', () => go(null));
  } else go(null);
}

/* ------------------------------------------------------------------ http */

const UI = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const json = (code, o) => { res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(o)); };

  if (url.pathname === '/') {
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    return res.end(UI.replace('__TOOLS__', JSON.stringify(TOOLS)));
  }

  if (url.pathname === '/api/probe') {
    const f = url.searchParams.get('path');
    try {
      if (!f || !fs.existsSync(f)) throw new Error('File not found. Paste the full path, or use Browse.');
      const src = probe(f);
      const dx = diagnose(src);
      const p = plan({ ...src, path: f }, url.searchParams.get('platform') || 'tiktok',
        { uploadPath: 'web', preconditioning: !src.hdr });
      return json(200, { src, dx, plan: p, tool: identifyToolchain(src) });
    } catch (e) { return json(400, { error: e.message }); }
  }

  if (url.pathname === '/api/start' && req.method === 'POST') {
    let b = '';
    req.on('data', d => b += d);
    req.on('end', () => {
      try {
        const o = JSON.parse(b);
        const src = probe(o.path);
        const p = plan({ ...src, path: o.path }, o.platform || 'tiktok',
          { uploadPath:'web', preconditioning: !src.hdr });
        if (o.keep4k) { p.output.width = src.width; p.output.height = src.height; }
        if (o.forceSdr) { p.output.hdr = false; }
        const out = o.path.replace(/\.[^.]+$/, '') + (o.mode === 'remux' ? '-faststart.mp4' : '-vague.mp4');
        const id = String(Date.now());
        jobs.set(id, { state:'queued', pct:0, stage:'Starting', log:[], src, plan:p, out, speed:'' });
        setImmediate(() => runJob(id, o.path, { ...o, hdr: p.output.hdr && !o.forceSdr }));
        return json(200, { id, out, plan: p });
      } catch (e) { return json(400, { error: e.message }); }
    });
    return;
  }

  if (url.pathname === '/api/job') {
    const j = jobs.get(url.searchParams.get('id'));
    if (!j) return json(404, { error: 'no such job' });
    return json(200, { state:j.state, pct:j.pct, stage:j.stage, speed:j.speed,
      message:j.message, out:j.out, result:j.result, log:j.log.slice(-12) });
  }

  if (url.pathname === '/api/reveal') {
    const f = url.searchParams.get('path');
    if (process.platform === 'win32') execFile('explorer', ['/select,', path.resolve(f)]);
    else if (process.platform === 'darwin') execFile('open', ['-R', f]);
    else execFile('xdg-open', [path.dirname(f)]);
    return json(200, { ok: true });
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, HOST, () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`\n  Vague is running at ${url}\n  Close this window to quit.\n`);
  if (!process.env.VAGUE_NO_OPEN) {
    const open = process.platform === 'win32' ? ['cmd', ['/c','start','',url]]
               : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try { spawn(open[0], open[1], { detached:true, stdio:'ignore' }).unref(); } catch {}
  }
});
