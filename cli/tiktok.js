/**
 * TikTok inbox-draft uploader.
 *
 * Uses the OFFICIAL Content Posting API, in the one mode that works without
 * passing TikTok's app audit: upload-to-inbox (`video.upload` scope).
 *
 *   PC file  ──API──▶  TikTok drafts on your phone  ──you post it in the app
 *
 * What this does NOT do:
 *   • It is not a bypass. TikTok transcodes exactly as it always does.
 *   • It cannot publish publicly. Unaudited clients are forced to SELF_ONLY
 *     for Direct Post; inbox-draft sidesteps that by keeping you in the loop.
 *
 * Why it is useful anyway: it moves an optimised file from this machine into
 * your phone's TikTok app with no lossy transfer in between.
 *
 * Setup: see cli/TIKTOK-SETUP.md
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CONFIG_DIR  = path.join(os.homedir(), '.vague');
const TOKEN_FILE  = path.join(CONFIG_DIR, 'tiktok.json');
const APP_FILE    = path.join(CONFIG_DIR, 'tiktok-app.json');
const REDIRECT_PORT = 4788;
const REDIRECT_URI  = `http://localhost:${REDIRECT_PORT}/callback`;

const AUTH_URL  = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const API       = 'https://open.tiktokapis.com';

/* ------------------------------------------------------------------ utils */

function ensureDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

function loadApp() {
  if (!fs.existsSync(APP_FILE)) {
    throw new Error(
      `No TikTok app credentials.\n\n` +
      `Create ${APP_FILE} containing:\n` +
      `  {\n    "client_key": "awxxxxxxxxxxxxxx",\n    "client_secret": "xxxxxxxxxxxx"\n  }\n\n` +
      `Get these from https://developers.tiktok.com → your app.\n` +
      `See cli/TIKTOK-SETUP.md for the full walkthrough.`);
  }
  return JSON.parse(fs.readFileSync(APP_FILE, 'utf8'));
}

const loadTokens = () =>
  fs.existsSync(TOKEN_FILE) ? JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) : null;

function saveTokens(t) {
  ensureDir();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ ...t, saved_at: Date.now() }, null, 2),
    { mode: 0o600 });
}

function request(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method, headers,
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c','start','',url]]
            : process.platform === 'darwin' ? ['open', [url]]
            : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref(); } catch {}
}

/* ------------------------------------------------------------------- auth */

async function login() {
  const app = loadApp();
  const state = crypto.randomBytes(16).toString('hex');

  const authUrl = `${AUTH_URL}?` + new URLSearchParams({
    client_key: app.client_key,
    // video.upload = inbox drafts, no audit needed.
    // video.publish would be direct posting, but unaudited apps are forced private.
    scope: 'user.info.basic,video.upload',
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    state,
  });

  console.log('\n  Opening your browser to authorise…');
  console.log(`  If it does not open, visit:\n\n  ${authUrl}\n`);

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }
      const err = u.searchParams.get('error');
      const got = u.searchParams.get('code');
      const st  = u.searchParams.get('state');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><meta charset=utf-8>
        <body style="font-family:system-ui;background:#fdf6e9;color:#161310;padding:60px;text-align:center">
        <h1 style="font-size:28px">${err ? '❌ Authorisation failed' : '✅ Connected'}</h1>
        <p>${err ? err : 'You can close this tab and go back to the terminal.'}</p></body>`);
      server.close();
      if (err) return reject(new Error(err));
      if (st !== state) return reject(new Error('State mismatch — possible CSRF, aborted.'));
      resolve(got);
    });
    server.listen(REDIRECT_PORT, '127.0.0.1', () => openBrowser(authUrl));
    setTimeout(() => { server.close(); reject(new Error('Timed out after 5 minutes.')); }, 300000);
  });

  const res = await request(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: app.client_key,
      client_secret: app.client_secret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });

  if (!res.json?.access_token) {
    throw new Error(`Token exchange failed: ${res.body.slice(0, 400)}`);
  }
  saveTokens(res.json);
  return res.json;
}

/** TikTok ROTATES the refresh token on every use — always persist the new one. */
async function getAccessToken() {
  const app = loadApp();
  let t = loadTokens();
  if (!t) throw new Error('Not logged in. Run:  ./vague.sh --tiktok-login');

  const age = (Date.now() - (t.saved_at || 0)) / 1000;
  if (age < (t.expires_in || 86400) - 300) return t.access_token;

  const res = await request(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: app.client_key,
      client_secret: app.client_secret,
      grant_type: 'refresh_token',
      refresh_token: t.refresh_token,
    }).toString(),
  });
  if (!res.json?.access_token) {
    throw new Error(`Refresh failed — run ./vague.sh --tiktok-login again.\n${res.body.slice(0,300)}`);
  }
  saveTokens(res.json);
  return res.json.access_token;
}

/* ----------------------------------------------------------------- upload */

/**
 * Upload a file to the creator's TikTok inbox as a draft.
 * @param {string} file
 * @param {(pct:number,label:string)=>void} onProgress
 */
async function uploadDraft(file, onProgress = () => {}) {
  const token = await getAccessToken();
  const size  = fs.statSync(file).size;

  // TikTok chunk rules: 5 MB minimum, 64 MB maximum, whole file if under 64 MB.
  const MIN = 5 * 1024 * 1024, MAX = 64 * 1024 * 1024;
  let chunkSize, chunkCount;
  if (size <= MAX) { chunkSize = size; chunkCount = 1; }
  else {
    chunkSize = Math.min(MAX, Math.max(MIN, Math.ceil(size / Math.ceil(size / MAX))));
    chunkCount = Math.ceil(size / chunkSize);
  }

  onProgress(2, 'Requesting upload slot');
  const init = await request(`${API}/v2/post/publish/inbox/video/init/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: size,
        chunk_size: chunkSize,
        total_chunk_count: chunkCount,
      },
    }),
  });

  const err = init.json?.error;
  if (!init.json?.data?.upload_url) {
    throw new Error(`Init failed (${init.status}): ${err?.code || ''} ${err?.message || init.body.slice(0,300)}`);
  }
  const { upload_url, publish_id } = init.json.data;

  // PUT the bytes, chunk by chunk.
  const fd = fs.openSync(file, 'r');
  try {
    for (let i = 0; i < chunkCount; i++) {
      const start = i * chunkSize;
      const end   = Math.min(start + chunkSize, size) - 1;
      const len   = end - start + 1;
      const buf   = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);

      const put = await new Promise((resolve, reject) => {
        const u = new URL(upload_url);
        const req = https.request({
          hostname: u.hostname, path: u.pathname + u.search, method: 'PUT',
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': len,
            'Content-Range': `bytes ${start}-${end}/${size}`,
          },
        }, res => {
          let d = ''; res.on('data', c => d += c);
          res.on('end', () => resolve({ status: res.statusCode, body: d }));
        });
        req.on('error', reject);
        req.write(buf);
        req.end();
      });

      if (put.status >= 400) throw new Error(`Chunk ${i+1}/${chunkCount} failed (${put.status}): ${put.body.slice(0,200)}`);
      onProgress(5 + Math.round(((i + 1) / chunkCount) * 85), `Uploading chunk ${i+1}/${chunkCount}`);
    }
  } finally { fs.closeSync(fd); }

  // Poll until TikTok finishes ingesting it.
  onProgress(92, 'Waiting for TikTok to process');
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const st = await request(`${API}/v2/post/publish/status/fetch/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id }),
    });
    const s = st.json?.data?.status;
    if (s === 'SEND_TO_USER_INBOX' || s === 'PUBLISH_COMPLETE') {
      onProgress(100, 'Done');
      return { publish_id, status: s };
    }
    if (s === 'FAILED') {
      throw new Error(`TikTok rejected it: ${st.json?.data?.fail_reason || 'unknown'}`);
    }
    onProgress(92 + Math.min(7, i), `Processing… (${s || 'pending'})`);
  }
  return { publish_id, status: 'TIMEOUT',
           note: 'Still processing after 3 minutes — check your TikTok drafts.' };
}

module.exports = { login, uploadDraft, getAccessToken, TOKEN_FILE, APP_FILE };
