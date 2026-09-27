import { readFileSync } from 'fs';
import { faststartRemux } from '../extension/remux.js';
import { probeFile } from '../extension/probe.js';

class NodeFile {
  constructor(b,n){ this.buf=b; this.name=n; this.size=b.length; this.type='video/mp4'; }
  slice(a,b){ const s=a<0?this.size+a:a,e=b===undefined?this.size:(b<0?this.size+b:b);
    const x=this.buf.subarray(s,e);
    return { arrayBuffer: async()=>x.buffer.slice(x.byteOffset,x.byteOffset+x.byteLength) }; }
  async arrayBuffer(){ return this.buf.buffer.slice(this.buf.byteOffset,this.buf.byteOffset+this.buf.length); }
}
globalThis.Blob = class { constructor(p,o){ this._b=Buffer.concat(p.map(x=>Buffer.from(x instanceof Uint8Array?x:new Uint8Array(x))));
  this.size=this._b.length; this.type=o?.type||''; }
  async arrayBuffer(){ return this._b.buffer.slice(this._b.byteOffset,this._b.byteOffset+this._b.length); } };

const src = new NodeFile(readFileSync('test/f_moov_at_end_dv.mp4'),'f.mp4');
let pass=0,fail=0; const chk=(l,c)=>{c?(pass++,console.log('  ✓ '+l)):(fail++,console.log('  ✗ FAIL '+l));};

console.log('\n── Remux WITHOUT the bypass ──');
const a = await faststartRemux(src);
const pa = await probeFile(new NodeFile(Buffer.from(await a.blob.arrayBuffer()),'a.mp4'));
console.log(`  duration ${pa.durationSec}s · DV=${pa.hasDolbyVisionRPU} · ${pa.width}x${pa.height} ${pa.bitDepth}-bit`);

console.log('\n── Remux WITH duration zeroing ──');
const b = await faststartRemux(src, ()=>{}, { zeroDuration:true });
const outB = Buffer.from(await b.blob.arrayBuffer());
const pb = await probeFile(new NodeFile(outB,'b.mp4'));
console.log(`  duration ${pb.durationSec}s · DV=${pb.hasDolbyVisionRPU} · ${pb.width}x${pb.height} ${pb.bitDepth}-bit`);
console.log(`  patched: ${JSON.stringify(b.durationZeroed)}`);

console.log('\nASSERTIONS');
chk('normal remux keeps real duration', pa.durationSec > 0);
chk('safe mode touches ONLY the movie header', b.durationZeroed.mvhd===1 && b.durationZeroed.tkhd===0 && b.durationZeroed.mdhd===0);
chk('safe mode writes 1 tick, not 0 (stays a valid file)', b.durationZeroed.value === 1);
chk('file size still identical (lossless)', outB.length === src.size);
chk('Dolby Vision still intact after bypass', pb.hasDolbyVisionRPU === true);
chk('DV profile still 8.4', pb.dvProfile === 8.4);
chk('HLG transfer still intact', pb.colorTransfer === 'arib-std-b67');
chk('10-bit still intact', pb.bitDepth === 10);
chk('resolution still intact', pb.width===2160 && pb.height===3840);
chk('fps still readable from stts', pb.fps === 60);

// the actual bytes: mvhd duration must be 1, track headers untouched
{
  const bb = Buffer.from(await b.blob.arrayBuffer());
  const mv = bb.indexOf(Buffer.from('mvhd'));
  const dur = bb.readUInt32BE(mv + 4 + 4 + 12);   // v0: after type, ver/flags, create, mod, timescale
  chk('mvhd duration byte-level == 1', dur === 1, `  (read ${dur})`);
  const tk = bb.indexOf(Buffer.from('tkhd'));
  const tdur = bb.readUInt32BE(tk + 4 + 4 + 16);
  chk('tkhd duration left intact', tdur > 0, `  (${tdur})`);
}

// aggressive mode still available, explicitly
const c = await faststartRemux(src, ()=>{}, { zeroDuration:'aggressive' });
chk('aggressive mode also zeroes tkhd + mdhd',
    c.durationZeroed.mvhd===1 && c.durationZeroed.tkhd===1 && c.durationZeroed.mdhd===1);

console.log(`\n${'═'.repeat(60)}\n${fail?'❌':'✅'}  ${pass} passed, ${fail} failed`);
