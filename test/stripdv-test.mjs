/** Removing Dolby Vision signalling while keeping the HLG base layer. */
import { readFileSync } from 'fs';
import { faststartRemux } from '../extension/remux.js';
import { probeFile } from '../extension/probe.js';

class NF{constructor(b,n){this.buf=b;this.name=n;this.size=b.length;this.type='video/mp4';}
 slice(a,b){const s=a<0?this.size+a:a,e=b===undefined?this.size:(b<0?this.size+b:b);const x=this.buf.subarray(s,e);
 return{arrayBuffer:async()=>x.buffer.slice(x.byteOffset,x.byteOffset+x.byteLength)};}
 async arrayBuffer(){return this.buf.buffer.slice(this.buf.byteOffset,this.buf.byteOffset+this.buf.length);}}
globalThis.Blob=class{constructor(p,o){this._b=Buffer.concat(p.map(x=>Buffer.from(x instanceof Uint8Array?x:new Uint8Array(x))));this.size=this._b.length;this.type=o?.type||'';}
 async arrayBuffer(){return this._b.buffer.slice(this._b.byteOffset,this._b.byteOffset+this._b.length);}};

// b_1080p60_dv.mp4 = HLG base + Dolby Vision 8.4 RPU config
const src=new NF(readFileSync(new URL('./b_1080p60_dv.mp4',import.meta.url)),'b.mp4');
let pass=0,fail=0; const chk=(l,c)=>{c?(pass++,console.log('  ✓ '+l)):(fail++,console.log('  ✗ FAIL '+l));};

const before = await probeFile(src);
console.log(`\nBEFORE  ${before.width}x${before.height} ${before.codec} ${before.bitDepth}-bit · ` +
            `${before.colorTransfer} · DV=${before.hasDolbyVisionRPU?'yes p'+before.dvProfile:'no'} · verdict=${before.hdrFormat}`);

const r = await faststartRemux(src, ()=>{}, { stripDV:true });
const out = Buffer.from(await r.blob.arrayBuffer());
const after = await probeFile(new NF(out,'out.mp4'));
console.log(`AFTER   ${after.width}x${after.height} ${after.codec} ${after.bitDepth}-bit · ` +
            `${after.colorTransfer} · DV=${after.hasDolbyVisionRPU?'yes':'no'} · verdict=${after.hdrFormat}`);
console.log(`\n${r.note}\n`);

chk('Dolby Vision config box removed',   after.hasDolbyVisionRPU === false);
chk('now reports as plain HLG',          after.hdrFormat === 'hlg');
chk('still HDR',                         after.hdr === true);
chk('HLG transfer kept',                 after.colorTransfer === 'arib-std-b67');
chk('BT.2020 primaries kept',            after.colorPrimaries === 'bt2020');
chk('10-bit kept',                       after.bitDepth === 10);
chk('resolution kept',                   after.width===1080 && after.height===1920);
chk('60 fps kept',                       after.fps === 60);
chk('codec still hevc',                  after.codec === 'hevc');
chk('file size unchanged (lossless)',    out.length === src.size);
chk('dvcC renamed to free',              !out.includes(Buffer.from('dvcC')) && out.includes(Buffer.from('free')));

console.log(`\n${'═'.repeat(56)}\n${fail?'❌':'✅'}  ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
