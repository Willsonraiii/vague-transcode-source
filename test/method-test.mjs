/**
 * The 60/120fps "method" (timescale patch) — unit tests.
 *
 * Mirrors the reference implementation (ut0ku/120fps-method, C++):
 * divide timescale AND duration of every mvhd/mdhd by the divider
 * (2 for 60 fps, 4 for 120). Byte lengths never change, stts and sample
 * data are untouched, real-time duration (dur/ts) is preserved.
 */
import { faststartRemux } from '../extension/remux.js';
import { probeFile } from '../extension/probe.js';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const chk = (l, c, extra = '') => {
  c ? (pass++, console.log(`  ✓ ${l}${extra}`)) : (fail++, console.log(`  ✗ FAIL ${l}${extra}`));
};
const toFile = (buf, name) => ({
  name, size: buf.length,
  arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
  slice(a, b) {
    const s = a < 0 ? this.size + a : a;
    const e = b === undefined ? this.size : (b < 0 ? this.size + b : b);
    return { arrayBuffer: async () => this.arrayBuffer().then(ab => ab.slice(s, e)) };
  },
});
const mvhd = b => {
  const i = b.indexOf(Buffer.from('mvhd'));
  return { ts: b.readUInt32BE(i + 16), dur: b.readUInt32BE(i + 20) };
};

console.log('\n── 1. 60 fps file, divider 2 (the standard method) ──');
const src = readFileSync('test/b_1080p60_dv.mp4');
const r1 = await faststartRemux(toFile(src, 'b.mp4'), () => {},
  { rebrand: true, stripEdits: true, fpsGuard: 2 });
const out1 = Buffer.from(await r1.blob.arrayBuffer());
chk('method reported', r1.fpsGuarded && r1.fpsGuarded.mvhd >= 1 && r1.fpsGuarded.mdhd >= 1,
    `  ÷${r1.fpsGuarded?.divider}, ${r1.fpsGuarded?.mvhd} mvhd + ${r1.fpsGuarded?.mdhd} mdhd`);
chk('size byte-identical (lossless)', out1.length === src.length, `  ${out1.length} vs ${src.length}`);
chk('mvhd timescale halved', mvhd(out1).ts === Math.floor(mvhd(src).ts / 2),
    `  ${mvhd(src).ts} → ${mvhd(out1).ts}`);
chk('real-time duration preserved (dur/ts equal)',
    Math.abs(mvhd(out1).dur / mvhd(out1).ts - mvhd(src).dur / mvhd(src).ts) < 0.01,
    `  ${(mvhd(src).dur / mvhd(src).ts).toFixed(2)}s → ${(mvhd(out1).dur / mvhd(out1).ts).toFixed(2)}s`);
const p1 = await probeFile(toFile(out1, 'o.mp4'));
chk('declared fps now reads 30', Math.abs(p1.fps - 30) < 0.1, `  ${p1.fps}`);
chk('frame count unchanged', p1.frameCount === 600, `  ${p1.frameCount}`);
chk('Dolby Vision preserved', p1.hasDolbyVisionRPU === true);

console.log('\n── 2. divider 4 (the 120 fps variant, math check) ──');
const r2 = await faststartRemux(toFile(src, 'b.mp4'), () => {}, { fpsGuard: 4 });
const out2 = Buffer.from(await r2.blob.arrayBuffer());
const p2 = await probeFile(toFile(out2, 'o.mp4'));
chk('declared fps now reads 15 (60÷4)', Math.abs(p2.fps - 15) < 0.1, `  ${p2.fps}`);
chk('size byte-identical', out2.length === src.length);

console.log('\n── 3. moov-at-end file: method + faststart together ──');
const src3 = readFileSync('test/f_moov_at_end_dv.mp4');
const r3 = await faststartRemux(toFile(src3, 'f.mp4'), () => {},
  { rebrand: true, stripEdits: true, fpsGuard: 2 });
const out3 = Buffer.from(await r3.blob.arrayBuffer());
chk('moov moved AND method applied', r3.moved === true && r3.fpsGuarded?.mvhd >= 1);
chk('size byte-identical', out3.length === src3.length, `  ${out3.length} vs ${src3.length}`);
chk('moov before mdat', out3.indexOf(Buffer.from('moov')) < out3.indexOf(Buffer.from('mdat')));

console.log('\n── 4. divider 1 = explicit no-op ──');
const r4 = await faststartRemux(toFile(src, 'b.mp4'), () => {}, { fpsGuard: 1 });
chk('nothing changed', !r4.fpsGuarded || (!r4.fpsGuarded.mvhd && !r4.fpsGuarded.mdhd));

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
