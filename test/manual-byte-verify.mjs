/** Byte-verify what the site's Fix button actually produces, and dump the UX text. */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const SITE = 'http://127.0.0.1:8090';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = '/tmp/site-verify';
mkdirSync(OUT, { recursive: true });

const mvhd = b => {
  const i = b.indexOf(Buffer.from('mvhd'));
  return { timescale: b.readUInt32BE(i + 16), duration: b.readUInt32BE(i + 20) };
};
const moovBeforeMdat = b => b.indexOf(Buffer.from('moov')) < b.indexOf(Buffer.from('mdat'));

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

async function flow(file, tick, label) {
  await page.goto(SITE, { waitUntil: 'networkidle' });
  await page.setInputFiles('#file', path.join(HERE, file.replace(/^test\//, '')));
  await page.waitForSelector('#run', { timeout: 15000 });
  const fixCardText = await page.locator('#results .card', { hasText: /Fix it|Apply patch/ }).first().innerText().catch(() => '(no card)');
  console.log(`\n########## ${label} — file: ${file} ##########`);
  console.log('--- FIX CARD TEXT ---\n' + fixCardText);
  if (tick === 'patch') await page.locator('#patch').check().catch(e => console.log('PATCH CHECK FAILED:', e.message));
  if (tick === 'nodv') await page.locator('#nodv').check().catch(e => console.log('NODV CHECK FAILED:', e.message));
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.locator('#run').click();
  const d = await dl;
  const p = path.join(OUT, d.suggestedFilename());
  await d.saveAs(p);
  const out = readFileSync(p);
  const src = readFileSync(path.join(HERE, file.replace(/^test\//, '')));
  console.log('--- BYTE VERIFICATION ---');
  console.log('downloaded   :', d.suggestedFilename(), out.length, 'bytes');
  console.log('size identical:', out.length === src.length ? 'PASS' : `FAIL (src ${src.length})`);
  console.log('mvhd          :', JSON.stringify(mvhd(out)), tick === 'patch' ? '(want duration 1)' : '(want unchanged)');
  console.log('moov before mdat:', moovBeforeMdat(out) ? 'yes (faststart)' : 'no');
  console.log('dvcC still in :', out.includes(Buffer.from('dvcC')) ? 'yes' : 'no');
  await page.waitForTimeout(1200);
  const after = await page.locator('#results').innerText();
  const checklist = after.split('Upload it')[1] || '';
  console.log('--- CHECKLIST (post-fix guidance) ---\n' + (after.includes('Upload it') ? 'Upload it' + checklist.slice(0, 900) : after.slice(-700)));
}

await flow('test/e_rot90.mp4', 'patch', 'FLOW A: SDR + duration patch');
await flow('test/f_moov_at_end_dv.mp4', 'nodv', 'FLOW B: DV, moov at end + strip-DV');

console.log('\npage errors:', errors.length ? errors : 'none');
await browser.close();
