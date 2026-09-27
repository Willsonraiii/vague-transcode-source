/**
 * Real browser test of the website.
 * Loads the page in headless Chromium, feeds it actual MP4 fixtures,
 * clicks the buttons, and checks the downloaded bytes.
 *
 *   node test/e2e-site.mjs            (expects the site served on :8090)
 */
import { chromium } from 'playwright-core';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let pass = 0, fail = 0;
const chk = (l, c, extra = '') => {
  c ? (pass++, console.log(`  ✓ ${l}${extra}`)) : (fail++, console.log(`  ✗ FAIL ${l}${extra}`));
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

async function load() {
  errors.length = 0;
  await page.goto(BASE, { waitUntil: 'networkidle' });
}

/* ---------------------------------------------------------- 1. page loads */
console.log('\n── 1. Page load ──');
await load();
chk('page responds', (await page.title()).includes('Vague'));
chk('no JS errors on load', errors.length === 0, errors.length ? '  ' + errors[0] : '');
chk('drop zone rendered', await page.locator('#drop').isVisible());
chk('compare zone rendered', await page.locator('#drop2').isVisible());
chk('all 4 engine modules loaded', await page.evaluate(async () => {
  const m = await Promise.all(['probe','hdr-doctor','profiles','remux']
    .map(n => import(`./lib/${n}.js`).then(() => 1).catch(() => 0)));
  return m.every(Boolean);
}));

/* ------------------------------------------------- 2. probe a real fixture */
console.log('\n── 2. Probe a Dolby Vision file ──');
const dvFile = path.join(HERE, 'b_1080p60_dv.mp4');
chk('fixture exists', existsSync(dvFile));
await page.setInputFiles('#file', dvFile);
await page.waitForSelector('#run', { timeout: 15000 });
chk('no JS errors while probing', errors.length === 0, errors.length ? '  ' + errors[0] : '');

const text = await page.locator('#results').innerText();
chk('shows resolution 1080×1920', text.includes('1080×1920'));
chk('shows 60 fps', /60\s*fps/.test(text));
chk('detects Dolby Vision', text.includes('Dolby Vision'));
chk('offers the plain-HDR option', await page.locator('#nodv').count() > 0);
chk('plain-HDR is ON by default (measured: TikTok delivers plain HLG)', await page.locator('#nodv').isChecked());
chk('signature match offered + pre-ticked', (await page.locator('#isom').count()) > 0 && (await page.locator('#isom').isChecked()));
chk('duration patch offered for HDR (experimental)', await page.locator('#patch').isEnabled());
chk('HDR patch warns about the §2.3b confound', /experimental on HDR/i.test(text) && /gallery/i.test(await page.locator('#patch').locator('..').innerText()));
chk('patch label carries the Sept 2026 post-block warning', /fail to post|cannot be published/i.test(text));
chk('60/120fps method offered (60fps file)', await page.locator('#method').count() > 0);
chk('method pre-ticked (default on)', await page.locator('#method').isChecked());
chk('raw probe present', text.toLowerCase().includes('raw probe'));
/* ------------------------------------------- 2b. FFMPEG-method card */
console.log('\n── 2b. FFMPEG method card ──');
chk('method card rendered', (await page.locator('#dlmethod').count()) > 0);
const mlbl = await page.locator('#dlmethod').innerText();
chk('button names the detected platform', /\(Windows\)|\(macOS\)|\(Linux\)/.test(mlbl), `  ${mlbl}`);
const mcmd = await page.locator('#methodcmd').textContent();
chk('command preview shows the recipe', /libx265/.test(mcmd) && /arib-std-b67/.test(mcmd) && /19200/.test(mcmd));
{
  const dl2 = page.waitForEvent('download', { timeout: 10000 });
  await page.locator('#dlmethod').click();
  const d2 = await dl2;
  const mscript = readFileSync(await d2.path(), 'utf8');
  chk('script downloads with platform name', /vague-method\.(bat|command|sh)$/.test(d2.suggestedFilename() || ''), `  ${d2.suggestedFilename()}`);
  chk('script = true x265 method', /libx265/.test(mscript) && /p010le/.test(mscript) && /hvc1/.test(mscript));
  chk('script = TikTok timescale + caps + faststart', /video_track_timescale 19200/.test(mscript) && /min\(iw,1080\)/.test(mscript) && /\+faststart/.test(mscript));
  chk('script auto-installs ffmpeg if missing', /winget|brew|apt install ffmpeg/.test(mscript));
}

await page.locator('#nodv').check();   // opt in, so the fix has something to do

/* ------------------------------------------------------- 3. run the fix */
console.log('\n── 3. Click Fix and capture the download ──');
const dl = page.waitForEvent('download', { timeout: 30000 });
await page.locator('#run').click();
let out = null;
try {
  const d = await dl;
  const p = await d.path();
  out = readFileSync(p);
  chk('download fired', true, `  ${d.suggestedFilename()}`);
} catch (e) {
  chk('download fired', false, '  ' + e.message.split('\n')[0]);
}
chk('no JS errors during fix', errors.length === 0, errors.length ? '  ' + errors[0] : '');

if (out) {
  const src = readFileSync(dvFile);
  chk('output is byte-identical in size (lossless)', out.length === src.length,
      `  ${out.length} vs ${src.length}`);
  chk('dvcC removed from output', !out.includes(Buffer.from('dvcC')));
  chk('free padding present', out.includes(Buffer.from('free')));
  chk('still HEVC', out.includes(Buffer.from('hvc1')));
  chk('output brand is isom (TikTok muxer brand)', out.slice(8,12).toString() === 'isom', `  ${out.slice(8,12).toString()}`);
  const after = await page.locator('#results').innerText();
  chk('UI reports what it did', /Dolby Vision signalling removed|plain HDR/i.test(after));
  // the verify card is built async (re-probe of the output) — wait for it
  await page.waitForSelector('#verify', { timeout: 20000 }).catch(() => {});
  chk('verification card rendered', await page.locator('#verify').count() > 0);
  const vtxt = await page.locator('#verify').innerText().catch(() => '');
  chk('verification proves byte-identity', /byte-identical/.test(vtxt));
  chk('verification shows moov moved', /moov at front/.test(vtxt));
  chk('verification shows DV removed', /plain HLG HDR/.test(vtxt));
  chk('verification shows signature row', /timescale/.test(vtxt));
  chk('verification shows method applied (declared 30 fps)', /declares 30 fps \(method ÷2\)/.test(vtxt));
  chk('output declared 30 fps — samples intact', /method ÷2/.test(vtxt));
  // the verify card is built async; wait for the checklist that follows it
  await page.waitForFunction(
    () => /upload it/i.test(document.querySelector('#results')?.innerText || ''),
    { timeout: 15000 }).catch(() => {});
  const after2 = await page.locator('#results').innerText();
  chk('upload checklist appeared', after2.includes('upload it'));
  chk('HDR routes shown: Studio Only-me flip + phone file route', /Only me/.test(after2) && /Everyone/.test(after2));
}

/* ------------------------------ 3b. HDR A/B test kit */
console.log('\n── 3b. HDR A/B test kit ──');
const kitNames = [];
await page.locator('#abkit').click();
for (let i = 0; i < 3; i++) {
  const d = await page.waitForEvent('download', { timeout: 30000 });
  kitNames.push(d.suggestedFilename());
}
chk('kit builds 3 files', kitNames.length === 3, `  ${kitNames.join(' · ')}`);
chk('A = full-recipe variant', /A-recipe\.mp4$/.test(kitNames[0] || ''));
chk('B = keepDV variant present', kitNames.some(n => /B-keepDV/.test(n)));
chk('C = untouched control present', kitNames.some(n => /C-untouched/.test(n)));
chk('kit decoder rendered', /B shows HDR, A doesn/.test(await page.evaluate(() => document.body.textContent)));

/* ------------------------------------- 4. SDR file gets desktop guidance */
console.log('\n── 4. SDR file routes to desktop ──');
await load();
await page.setInputFiles('#file', path.join(HERE, 'e_rot90.mp4'));
await page.waitForSelector('#run', { timeout: 15000 });
chk('duration patch available for SDR (§2.3b)', await page.locator('#patch').isEnabled());
await page.locator('#patch').check();
const dl2 = page.waitForEvent('download', { timeout: 30000 });
await page.locator('#run').click();
try { await dl2; chk('SDR + patch downloads', true); }
catch (e) { chk('SDR + patch downloads', false, '  ' + e.message.split('\n')[0]); }
await page.waitForFunction(
  () => /upload it/i.test(document.querySelector('#results')?.innerText || ''),
  { timeout: 15000 }).catch(() => {});
const sdrText = await page.locator('#results').innerText();
chk('SDR routed to DESKTOP', /TikTok Studio on desktop/i.test(sdrText));
const vtxt2 = await page.locator('#verify').innerText().catch(() => '');
chk('patch verified in output (0.00s — 1 tick)', /0\.00s — 1 tick/.test(vtxt2));
chk('checklist warns gallery undoes the patch', /gallery/i.test(sdrText));
chk('checklist offers the share-sheet route', /share sheet/i.test(sdrText));
chk('no JS errors', errors.length === 0, errors.length ? '  ' + errors[0] : '');

/* ------------------------------------------------- 5. compare mode works */
console.log('\n── 5. Compare mode ──');
await page.setInputFiles('#file2', path.join(HERE, 'a_4k60_pq.mp4'));
// wait for the table rather than guessing at a timeout
await page.waitForSelector('#cmp table', { timeout: 20000 }).catch(() => {});
const cmp = await page.locator('#cmp').innerText();
// innerText applies CSS text-transform, so compare case-insensitively
chk('comparison table rendered', /tiktok served/i.test(cmp) && /you sent/i.test(cmp));
chk('table has all 7 rows', ['Resolution','Frame rate','Codec','Colour','Transfer','Dolby Vision','Bitrate']
     .every(r => new RegExp(r,'i').test(cmp)));
chk('marks pass/fail per row', /[✓✗]/.test(cmp));
chk('shows a verdict', /survived|did not|Drop your source/i.test(cmp));
chk('no JS errors', errors.length === 0, errors.length ? '  ' + errors[0] : '');

/* ------------------------------------------------ 6. mobile viewport */
console.log('\n── 6. Mobile viewport (390×844) ──');
const m = await ctx.newPage();
await m.setViewportSize({ width: 390, height: 844 });
await m.goto(BASE, { waitUntil: 'networkidle' });
const overflow = await m.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
chk('no horizontal overflow', overflow <= 1, `  (${overflow}px)`);
const tap = await m.locator('#drop').boundingBox();
chk('drop zone is tappable', tap && tap.height >= 44, `  ${Math.round(tap?.height || 0)}px tall`);

/* ------------------------------------------------ 7. legal pages */
console.log('\n── 7. Privacy / Terms ──');
for (const pg of ['privacy.html', 'terms.html']) {
  const r = await page.goto(`${BASE}/${pg}`, { waitUntil: 'domcontentloaded' });
  chk(`${pg} loads`, r.status() === 200);
  chk(`${pg} has nav back to tool`, await page.locator('a[href="index.html"]').count() > 0);
}

await browser.close();
console.log(`\n${'═'.repeat(58)}\n${fail ? '❌' : '✅'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
