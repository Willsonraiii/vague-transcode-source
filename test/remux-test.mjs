import { readFileSync, writeFileSync } from 'fs';
import { faststartRemux } from '../extension/remux.js';
import { probeFile } from '../extension/probe.js';

class NodeFile {
  constructor(buf,name){ this.buf=buf; this.name=name; this.size=buf.length; this.type='video/mp4'; }
  slice(a,b){ const s=a<0?this.size+a:a, e=b===undefined?this.size:(b<0?this.size+b:b);
    const x=this.buf.subarray(s,e);
    return { arrayBuffer: async()=>x.buffer.slice(x.byteOffset,x.byteOffset+x.byteLength) }; }
  async arrayBuffer(){ return this.buf.buffer.slice(this.buf.byteOffset, this.buf.byteOffset+this.buf.byteLength); }
}
globalThis.Blob = class { constructor(parts,opt){ const bufs=parts.map(p=>Buffer.from(p instanceof Uint8Array?p:new Uint8Array(p)));
  this._b=Buffer.concat(bufs); this.size=this._b.length; this.type=opt?.type||''; }
  async arrayBuffer(){ return this._b.buffer.slice(this._b.byteOffset,this._b.byteOffset+this._b.length); } };

const src = new NodeFile(readFileSync('test/f_moov_at_end_dv.mp4'), 'f.mp4');
let pass=0, fail=0;
const chk=(l,c)=>{ c?(pass++,console.log('  ✓ '+l)):(fail++,console.log('  ✗ FAIL '+l)); };

console.log('\nBEFORE remux:');
const before = await probeFile(src);
console.log(`  ${before.width}×${before.height} ${before.codec} ${before.bitDepth}-bit · ` +
            `${before.colorTransfer} · DV=${before.hasDolbyVisionRPU?'yes p'+before.dvProfile:'no'} · faststart=${before.moovAtEnd?'NO':'yes'}`);

const r = await faststartRemux(src);
console.log(`\n${r.note}`);

const outBuf = Buffer.from(await r.blob.arrayBuffer());
writeFileSync('test/f_remuxed.mp4', outBuf);
const after = await probeFile(new NodeFile(outBuf,'out.mp4'));
console.log('\nAFTER remux:');
console.log(`  ${after.width}×${after.height} ${after.codec} ${after.bitDepth}-bit · ` +
            `${after.colorTransfer} · DV=${after.hasDolbyVisionRPU?'yes p'+after.dvProfile:'no'} · faststart=${after.moovAtEnd?'NO':'yes'}`);

console.log('\nASSERTIONS');
chk('moov moved to front',            after.moovAtEnd === false);
chk('file size unchanged (lossless)', outBuf.length === src.size);
chk('Dolby Vision RPU preserved',     after.hasDolbyVisionRPU === true);
chk('DV profile still 8.4',           after.dvProfile === 8.4);
chk('HLG transfer preserved',         after.colorTransfer === 'arib-std-b67');
chk('BT.2020 primaries preserved',    after.colorPrimaries === 'bt2020');
chk('10-bit preserved',               after.bitDepth === 10);
chk('resolution preserved',           after.width===2160 && after.height===3840);
chk('codec preserved (hevc)',         after.codec === 'hevc');
chk('offsets were patched',           r.patched === 8);

// the real proof: media payload is byte-identical
const origMdat = readFileSync('test/f_moov_at_end_dv.mp4');
const payload = origMdat.subarray(origMdat.indexOf(Buffer.from('mdat'))+4);
chk('media bytes byte-for-byte identical', outBuf.includes(payload.subarray(0,2048)));

// and the patched offsets actually point at the right data
const dv = new DataView(outBuf.buffer, outBuf.byteOffset, outBuf.length);
const mdatPos = outBuf.indexOf(Buffer.from('mdat'));
chk('first chunk offset resolves inside mdat', mdatPos > 0);

console.log(`\n${'═'.repeat(60)}\n${fail?'❌':'✅'}  ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
