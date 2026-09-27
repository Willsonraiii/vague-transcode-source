/**
 * TikTok-signature normalisation — unit tests.
 * Target signature (measured on delivered files): ftyp brand isom,
 * video track mdhd timescale 19200, plain HLG (no DV signalling).
 */
import { faststartRemux } from '../extension/remux.js';
import { probeFile } from '../extension/probe.js';
import { readFileSync, writeFileSync } from 'fs';

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
const BE32 = (b, o, v) => { b.writeUInt32BE(v, o); };

/* Build a ts=600 variant of the 60fps fixture (divide video ts, stts deltas,
   mdhd duration by 100 — exactly what an iPhone-style 600-timescale looks like). */
const orig = readFileSync('test/b_1080p60_dv.mp4');
const alt = Buffer.from(orig);
{
  // locate moov → trak(mdia: hdlr vide, mdhd, minf/stbl/stts)
  const find = (b, name, from = 0) => b.indexOf(Buffer.from(name), from);
  const moov = find(alt, 'moov');
  const mdhd = find(alt, 'mdhd', moov);
  const stts = find(alt, 'stts', moov);
  // mdhd v0: ts @ +12(rel to content start = idx+4), dur @ +16
  const tsOff = mdhd + 4 + 12, durOff = mdhd + 4 + 16;
  const ts = alt.readUInt32BE(tsOff), dur = alt.readUInt32BE(durOff);
  const n = alt.readUInt32BE(stts + 4 + 4);
  for (let i = 0; i < n; i++) {
    const dOff = stts + 4 + 8 + i * 8 + 4;
    BE32(alt, dOff, alt.readUInt32BE(dOff) / 100);
  }
  BE32(alt, tsOff, ts / 100);
  BE32(alt, durOff, dur / 100);
  console.log(`  (fixture variant: video ts ${ts} → ${ts / 100}, ${n} stts deltas rescaled)`);
}

console.log('\n── 1. Signature normalisation on a ts=600 file ──');
const r1 = await faststartRemux(toFile(alt, 'b600.mp4'), () => {},
  { rebrand: true, stripEdits: true, stripDV: true, isoSignature: true });
const out1 = Buffer.from(await r1.blob.arrayBuffer());
chk('reported', r1.isoSigned && r1.isoSigned.tracks === 1, `  ×${r1.isoSigned?.factor}`);
chk('size byte-identical', out1.length === alt.length);
chk('brand is isom', out1.slice(8, 12).toString() === 'isom', `  ${out1.slice(8, 12)}`);
const p1 = await probeFile(toFile(out1, 'o.mp4'));
const vt1 = p1._debug.tracks.find(t => t.codec === 'hevc');
chk('video timescale is 19200', vt1 && vt1.timescale === 19200, `  ${vt1 && vt1.timescale}`);
chk('fps still reads 60', Math.abs(p1.fps - 60) < 0.1, `  ${p1.fps}`);
chk('frame count unchanged', p1.frameCount === 600, `  ${p1.frameCount}`);
chk('duration preserved', Math.abs(p1.durationSec - 10) < 0.1, `  ${p1.durationSec}s`);
chk('DV stripped (plain HLG)', p1.hasDolbyVisionRPU === false);

console.log('\n── 2. Non-integral timescale is skipped safely ──');
const r2 = await faststartRemux(toFile(orig, 'b.mp4'), () => {},
  { rebrand: true, stripEdits: true, isoSignature: true });
const out2 = Buffer.from(await r2.blob.arrayBuffer());
chk('skipped (ts 60000 not integral to 19200)', r2.isoSigned && r2.isoSigned.tracks === 0 && r2.isoSigned.skipped >= 1);
chk('size still byte-identical', out2.length === orig.length);
const p2 = await probeFile(toFile(out2, 'o.mp4'));
chk('fps untouched', Math.abs(p2.fps - 60) < 0.1, `  ${p2.fps}`);

console.log('\n── 3. Signature + frame-rate method compose ──');
const r3 = await faststartRemux(toFile(alt, 'b600.mp4'), () => {},
  { rebrand: true, stripEdits: true, stripDV: true, isoSignature: true, fpsGuard: 2 });
const out3 = Buffer.from(await r3.blob.arrayBuffer());
const p3 = await probeFile(toFile(out3, 'o.mp4'));
const vt3 = p3._debug.tracks.find(t => t.codec === 'hevc');
chk('timescale 19200 ÷2 = 9600', vt3 && vt3.timescale === 9600, `  ${vt3 && vt3.timescale}`);
chk('declared fps 30 (method)', Math.abs(p3.fps - 30) < 0.1, `  ${p3.fps}`);
chk('frames intact', p3.frameCount === 600, `  ${p3.frameCount}`);
chk('size byte-identical', out3.length === alt.length);

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
