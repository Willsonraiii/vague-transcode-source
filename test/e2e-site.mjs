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
chk('plain-HDR is OFF by default (reverted — HANDOFF §8.2)', !(await page.locator('#nodv').isChecked()));
chk('duration patch refused for HDR (§2.3b)', await page.locator('#patch').isDisabled());
chk('raw probe present', text.toLowerCase().includes('raw probe'));
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
  const after = await page.locator('#results').innerText();
  chk('UI reports what it did', /Dolby Vision signalling removed|plain HDR/i.test(after));
  chk('verification card rendered', await page.locator('#verify').count() > 0);
  const vtxt = await page.locator('#verify').innerText().catch(() => '');
  chk('verification proves byte-identity', /byte-identical/.test(vtxt));
  chk('verification shows moov moved', /moov at front/.test(vtxt));
  chk('verification shows DV removed', /plain HLG HDR/.test(vtxt));
  chk('upload checklist appeared', after.includes('upload it'));
  chk('HDR file routed to PHONE', /phone app/i.test(after));
}

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
await page.waitForTimeout(1500);
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
