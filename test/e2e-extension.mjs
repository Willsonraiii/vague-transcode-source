/**
 * Real browser test of the Chrome extension.
 *
 * Loads the unpacked extension into Chromium, opens a page that mimics
 * TikTok Studio's uploader, and verifies the hold-then-release behaviour:
 * the file must NOT reach the page until the user chooses an action.
 *
 *   node test/e2e-extension.mjs
 */
import { chromium } from 'playwright-core';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..', 'extension');
let pass = 0, fail = 0;
const chk = (l, c, extra = '') => {
  c ? (pass++, console.log(`  ✓ ${l}${extra}`)) : (fail++, console.log(`  ✗ FAIL ${l}${extra}`));
};

/* A stand-in for TikTok Studio: a file input that "uploads" on change. */
const FAKE_PAGE = `<!DOCTYPE html><meta charset=utf-8><title>Fake Studio</title>
<body style="font-family:sans-serif;padding:40px">
<h1>Upload</h1>
<input type="file" id="up" accept="video/*">
<div id="status">idle</div>
<script>
  window.__received = null;
  document.getElementById('up').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) { window.__received = { name: f.name, size: f.size };
             document.getElementById('status').textContent = 'UPLOADING ' + f.name; }
  });
</script></body>`;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-ext-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: false,   // extensions require a real browser (run under xvfb)
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
});

console.log('\n── 1. Extension loads ──');
// service worker registration proves the manifest parsed and background booted
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
chk('manifest accepted, service worker registered', !!sw, sw ? `  ${sw.url().split('/').pop()}` : '');
const extId = sw ? new URL(sw.url()).host : null;
chk('extension id resolved', !!extId, extId ? `  ${extId}` : '');

console.log('\n── 2. Engine modules are web-accessible ──');
const probe = await ctx.newPage();
if (extId) {
  for (const m of ['probe.js', 'remux.js', 'profiles.js', 'hdr-doctor.js']) {
    const r = await probe.goto(`chrome-extension://${extId}/${m}`).catch(() => null);
    chk(`${m} reachable`, !!r && r.status() === 200);
  }
  const off = await probe.goto(`chrome-extension://${extId}/offscreen.html`).catch(() => null);
  chk('offscreen.html reachable', !!off && off.status() === 200);
}
await probe.close();

console.log('\n── 3. Content script runs on a TikTok-like page ──');
// The content script only matches tiktok.com, so serve the fake page from there.
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('https://www.tiktok.com/**', route =>
  route.fulfill({ status: 200, contentType: 'text/html', body: FAKE_PAGE }));
await page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const panel = page.locator('#vague-guard');
chk('panel injected', await panel.count() > 0);
chk('no page errors', errors.length === 0, errors.length ? '  ' + errors[0] : '');

console.log('\n── 4. THE KEY BEHAVIOUR: upload is held ──');
await page.setInputFiles('#up', path.join(HERE, 'b_1080p60_dv.mp4'));
await page.waitForTimeout(3500);

const received = await page.evaluate(() => window.__received);
chk('page did NOT receive the file (held)', received === null,
    received ? `  leaked ${received.name}` : '');
const status = await page.locator('#status').textContent();
chk('page status still idle', status.trim() === 'idle', `  "${status.trim()}"`);

const ptext = await panel.innerText().catch(() => '');
chk('panel shows held state', /upload held/i.test(ptext));
chk('panel probed the file', /1080|60/.test(ptext));
chk('detected Dolby Vision', /dolby vision/i.test(ptext));
chk('plain-HDR option pre-ticked (measured default)', (await page.locator('#vg-nodv').count()) > 0 &&
    (await page.locator('#vg-nodv').isChecked()));
chk('signature option pre-ticked', (await page.locator('#vg-isom').count()) > 0 &&
    (await page.locator('#vg-isom').isChecked()));
chk('duration patch offered for HDR (experimental)', (await page.locator('#vg-zero').count()) > 0);
chk('60/120fps method offered + pre-ticked', (await page.locator('#vg-method').count()) > 0 &&
    (await page.locator('#vg-method').isChecked()));
chk('offers an action button', await page.locator('.vg-fix').count() > 0);

console.log('\n── 5. Release sends the fixed file through ──');
const btns = await page.locator('.vg-fix').allInnerTexts();
const idx = btns.findIndex(t => /optimize|fix container/i.test(t));
if (idx >= 0) {
  await page.locator('.vg-fix').nth(idx).click();
  await page.waitForTimeout(4000);
  const got = await page.evaluate(() => window.__received);
  chk('page received a file after release', !!got, got ? `  ${got.name} (${got.size}b)` : '');
  if (got) {
    const orig = fs.statSync(path.join(HERE, 'b_1080p60_dv.mp4')).size;
    chk('released file is the processed one', /fixed|faststart|patched|vague/i.test(got.name),
        `  ${got.name}`);
    chk('size unchanged (lossless)', got.size === orig, `  ${got.size} vs ${orig}`);
  }
  chk('no page errors during release', errors.length === 0, errors.length ? '  ' + errors[0] : '');
} else {
  chk('found a fix button', false, `  saw: ${btns.join(' | ').slice(0, 120)}`);
}

console.log('\n── 6. Cancel leaves the page untouched ──');
const p2 = await ctx.newPage();
await p2.route('https://www.tiktok.com/**', route =>
  route.fulfill({ status: 200, contentType: 'text/html', body: FAKE_PAGE }));
await p2.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded' });
await p2.waitForTimeout(2000);
await p2.setInputFiles('#up', path.join(HERE, 'e_rot90.mp4'));
await p2.waitForTimeout(3000);
chk('duration patch offered for SDR (§2.3b)', (await p2.locator('#vg-zero').count()) > 0);
const cancel = p2.locator('.vg-cancel');
if (await cancel.count()) {
  await cancel.click();
  await p2.waitForTimeout(800);
  chk('cancel leaves nothing uploaded', (await p2.evaluate(() => window.__received)) === null);
} else {
  chk('cancel button present', false);
}

await ctx.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log(`\n${'═'.repeat(58)}\n${fail ? '❌' : '✅'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
