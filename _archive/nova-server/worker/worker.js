/**
 * Vague Nova — transcode worker
 *
 * Pulls jobs from Redis, routes to the right encoder, verifies the output,
 * and settles or refunds coins. Video bytes never touch the API server.
 *
 *   npm i bullmq ioredis @aws-sdk/client-s3 @aws-sdk/s3-request-presigner pg
 *
 * Requires on PATH: ffmpeg, ffprobe, dovi_tool, hdr10plus_tool
 */

'use strict';

const { Worker } = require('bullmq');
const { spawn } = require('child_process');
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { Pool } = require('pg');

const { plan } = require('../../core/profiles');

const HAS_GPU = process.env.NOVA_GPU === '1';
const BUCKET  = process.env.R2_BUCKET;
const db = new Pool({ connectionString: process.env.DATABASE_URL });

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_KEY, secretAccessKey: process.env.R2_SECRET },
});

/* ------------------------------------------------------------------ utils */

function run(cmd, args, { timeoutMs = 30 * 60_000, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${cmd} timed out`)); }, timeoutMs);
    p.stdout.on('data', d => { stdout += d; });
    p.stderr.on('data', d => {
      const s = d.toString(); stderr += s;
      if (onProgress) {
        const m = s.match(/time=(\d+):(\d+):([\d.]+)/);
        if (m) onProgress(+m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]));
      }
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    p.on('close', code => {
      clearTimeout(timer);
      code === 0 ? resolve({ stdout, stderr })
                 : reject(new Error(`${cmd} exit ${code}\n${stderr.slice(-2000)}`));
    });
    p.on('error', reject);
  });
}

async function ffprobe(file) {
  const { stdout } = await run('ffprobe', ['-v','quiet','-print_format','json',
    '-show_streams','-show_format', file]);
  const j = JSON.parse(stdout);
  const v = j.streams.find(s => s.codec_type === 'video') || {};
  const [num, den] = (v.r_frame_rate || '0/1').split('/').map(Number);
  const [anum, aden] = (v.avg_frame_rate || '0/1').split('/').map(Number);
  return {
    width: v.width, height: v.height,
    fps: +(anum / (aden || 1)).toFixed(3),
    vfr: Math.abs(num / (den || 1) - anum / (aden || 1)) > 0.01,
    codec: v.codec_name, bitDepth: v.bits_per_raw_sample ? +v.bits_per_raw_sample : 8,
    colorPrimaries: v.color_primaries, colorTransfer: v.color_transfer,
    colorMatrix: v.color_space, colorRange: v.color_range,
    durationSec: +(j.format.duration || 0),
    bitrateMbps: +((+j.format.bit_rate || 0) / 1e6).toFixed(1),
    hasDolbyVisionRPU: !!(v.side_data_list || []).find(s => /dovi|DOVI/i.test(JSON.stringify(s))),
    _raw: v,
  };
}

/* --------------------------------------------------------- encoder routes */

/** Dolby Vision: extract RPU → encode base layer → verify. CPU only. */
async function encodeDolbyVision(inFile, outFile, p, dir, onProgress) {
  const rpu = path.join(dir, 'rpu.bin');

  // 1. extract
  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-v','error','-i',inFile,'-c:v','copy',
      '-bsf:v','hevc_mp4toannexb','-f','hevc','-']);
    const dv = spawn('dovi_tool', ['extract-rpu','-','-o',rpu]);
    ff.stdout.pipe(dv.stdin);
    let err = '';
    dv.stderr.on('data', d => { err += d; });
    dv.on('close', c => c === 0 ? resolve() : reject(new Error('dovi_tool extract failed: ' + err)));
    ff.on('error', reject); dv.on('error', reject);
  });

  const st = await fs.stat(rpu).catch(() => null);
  if (!st || st.size === 0) throw new Error('NO_RPU: source carries no Dolby Vision metadata');

  // 2. encode with the RPU re-injected
  const o = p.output;
  const x265 = [
    'hdr-opt=1', 'repeat-headers=1',
    'colorprim=bt2020', 'transfer=smpte2084', 'colormatrix=bt2020nc',
    `dolby-vision-rpu=${rpu}`, 'dolby-vision-profile=8.4',
    `vbv-maxrate=${Math.round(o.targetMbps * 1500)}`,
    `vbv-bufsize=${Math.round(o.targetMbps * 3000)}`,
  ].join(':');

  await run('ffmpeg', [
    '-v','error','-stats','-y','-i',inFile,
    '-vf',`scale=${o.width}:${o.height}:flags=lanczos,format=yuv420p10le`,
    '-r',String(o.fps),'-fps_mode','cfr',
    '-c:v','libx265','-preset','medium','-crf','18','-x265-params',x265,
    '-c:a','aac','-b:a','192k','-ar','48000','-ac','2',
    '-tag:v','hvc1','-movflags','+faststart', outFile,
  ], { onProgress });

  // 3. HARD GATE — never ship an unverified DV file
  const { stdout } = await run('dovi_tool', ['info','-i',outFile,'-f','0']).catch(() => ({ stdout: '' }));
  if (!/profile[^\d]*8/i.test(stdout)) {
    throw new Error('DV_VERIFY_FAILED: Dolby Vision RPU did not survive encoding');
  }
  return { verified: 'dolbyvision-8.4' };
}

/** HDR10 / HLG — NVENC can carry static metadata. */
async function encodeHdrGpu(inFile, outFile, p, onProgress) {
  const o = p.output;
  const hlg = p.decisions.color.target === 'hlg';
  await run('ffmpeg', [
    '-v','error','-stats','-y',
    ...(HAS_GPU ? ['-hwaccel','cuda'] : []),
    '-i',inFile,
    '-vf',`scale=${o.width}:${o.height}:flags=lanczos,format=p010le`,
    '-r',String(o.fps),'-fps_mode','cfr',
    '-c:v', HAS_GPU ? 'hevc_nvenc' : 'libx265',
    ...(HAS_GPU
      ? ['-preset','p6','-tune','hq','-rc','vbr','-cq','20',
         '-b:v',`${o.targetMbps}M`,'-maxrate',`${Math.round(o.targetMbps*1.5)}M`,
         '-bufsize',`${o.targetMbps*3}M`,'-profile:v','main10']
      : ['-preset','medium','-crf','19','-profile:v','main10',
         '-x265-params',`hdr-opt=1:repeat-headers=1:colorprim=bt2020:transfer=${hlg?'arib-std-b67':'smpte2084'}:colormatrix=bt2020nc`]),
    '-colorspace','bt2020nc','-color_primaries','bt2020',
    '-color_trc', hlg ? 'arib-std-b67' : 'smpte2084',
    '-c:a','aac','-b:a','192k','-ar','48000','-ac','2',
    '-tag:v','hvc1','-movflags','+faststart', outFile,
  ], { onProgress });
  return { verified: hlg ? 'hlg' : 'hdr10' };
}

/** SDR — the common path. GPU when available. */
async function encodeSdr(inFile, outFile, p, onProgress) {
  const o = p.output;
  const vf = p.ffmpeg[p.ffmpeg.indexOf('-vf') + 1]; // reuse the engine's filter chain
  await run('ffmpeg', [
    '-v','error','-stats','-y','-i',inFile,
    '-vf', vf,
    '-r',String(o.fps),'-fps_mode','cfr',
    '-c:v', HAS_GPU ? 'h264_nvenc' : 'libx264',
    ...(HAS_GPU
      ? ['-preset','p6','-tune','hq','-rc','vbr','-cq','19',
         '-b:v',`${o.targetMbps}M`,'-maxrate',`${Math.round(o.targetMbps*1.5)}M`,
         '-bufsize',`${o.targetMbps*3}M`,'-bf','3','-rc-lookahead','32']
      : ['-preset','slow','-crf','17','-maxrate',`${Math.round(o.targetMbps*1.5)}M`,
         '-bufsize',`${o.targetMbps*3}M`]),
    '-profile:v','high','-level','4.2',
    '-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709',
    '-c:a','aac','-b:a','192k','-ar','48000','-ac','2',
    '-movflags','+faststart', outFile,
  ], { onProgress });
  return { verified: 'sdr' };
}

/* ------------------------------------------------------------ coin settle */

async function settle(jobId, keyId, ok) {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    if (ok) {
      await c.query(
        `UPDATE encode_job SET state='delivered', settled_at=now()
          WHERE id=$1 AND state IN ('held','running')`, [jobId]);
    } else {
      const r = await c.query(
        `UPDATE encode_job SET state='failed', settled_at=now()
          WHERE id=$1 AND state IN ('held','running') RETURNING cost, key_id`, [jobId]);
      if (r.rowCount) {
        const { cost } = r.rows[0];
        await c.query(
          `INSERT INTO coin_ledger (key_id, delta, reason, job_id, idempotency)
           VALUES ($1,$2,'encode_refund',$3,$4)
           ON CONFLICT (idempotency) DO NOTHING`,
          [keyId, cost, jobId, `refund:${jobId}`]);
        await c.query(`UPDATE nova_key SET balance = balance + $2 WHERE id=$1`, [keyId, cost]);
      }
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(()=>{}); throw e; }
  finally { c.release(); }
}

/* ----------------------------------------------------------------- worker */

new Worker('nova-encode', async job => {
  const { jobId, keyId, srcKey, platform, uploadPath } = job.data;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-'));
  const inFile  = path.join(dir, 'in.mp4');
  const outFile = path.join(dir, 'out.mp4');

  try {
    await db.query(`UPDATE encode_job SET state='running' WHERE id=$1`, [jobId]);

    // download source
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: srcKey }));
    await new Promise((res, rej) => {
      const w = fsSync.createWriteStream(inFile);
      obj.Body.pipe(w).on('finish', res).on('error', rej);
    });

    const probe = await ffprobe(inFile);
    const p = plan({ ...probe, path: inFile }, platform, { uploadPath });
    await job.updateProgress({ stage: 'encoding', plan: p.output });

    const onProgress = sec => {
      if (probe.durationSec) job.updateProgress({ stage: 'encoding', pct: Math.min(99, (sec / probe.durationSec) * 100) });
    };

    let result;
    if (p.output.hdr && p.decisions.color.target === 'dv84') {
      result = await encodeDolbyVision(inFile, outFile, p, dir, onProgress);
    } else if (p.output.hdr) {
      result = await encodeHdrGpu(inFile, outFile, p, onProgress);
    } else {
      result = await encodeSdr(inFile, outFile, p, onProgress);
    }

    // verify the output is sane before charging for it
    const outProbe = await ffprobe(outFile);
    if (Math.abs(outProbe.fps - p.output.fps) > 0.5) {
      throw new Error(`FPS_MISMATCH: wanted ${p.output.fps}, produced ${outProbe.fps}`);
    }

    const outKey = `out/${jobId}.mp4`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: outKey, Body: fsSync.createReadStream(outFile),
      ContentType: 'video/mp4',
    }));

    // retention: source is deleted the moment it is no longer needed
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: srcKey })).catch(()=>{});
    await settle(jobId, keyId, true);

    return { outKey, plan: p.output, probe: outProbe, ...result };

  } catch (err) {
    console.error(`[job ${jobId}]`, err.message);
    await settle(jobId, keyId, false).catch(e => console.error('settle failed', e));
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: srcKey })).catch(()=>{});
    throw err;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(()=>{});
  }
}, {
  connection: { url: process.env.REDIS_URL },
  concurrency: HAS_GPU ? 2 : 1,
  lockDuration: 30 * 60_000,
});

console.log(`[nova-worker] up — mode=${HAS_GPU ? 'GPU (NVENC)' : 'CPU (x264/x265)'}`);
