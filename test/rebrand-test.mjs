/** QuickTime rebranding + edit-list neutralisation, on a fixture that has both. */
import { readFileSync } from 'fs';
import { faststartRemux } from '../extension/remux.js';

class NF{constructor(b,n){this.buf=b;this.name=n;this.size=b.length;this.type='video/mp4';}
 slice(a,b){const s=a<0?this.size+a:a,e=b===undefined?this.size:(b<0?this.size+b:b);const x=this.buf.subarray(s,e);
 return{arrayBuffer:async()=>x.buffer.slice(x.byteOffset,x.byteOffset+x.byteLength)};}
 async arrayBuffer(){return this.buf.buffer.slice(this.buf.byteOffset,this.buf.byteOffset+this.buf.length);}}
globalThis.Blob=class{constructor(p,o){this._b=Buffer.concat(p.map(x=>Buffer.from(x instanceof Uint8Array?x:new Uint8Array(x))));this.size=this._b.length;this.type=o?.type||'';}
 async arrayBuffer(){return this._b.buffer.slice(this._b.byteOffset,this._b.byteOffset+this._b.length);}};

const src=new NF(readFileSync(new URL('./g_qt_with_elst.mp4',import.meta.url)),'g.mp4');
let pass=0,fail=0; const chk=(l,c)=>{c?(pass++,console.log('  ✓ '+l)):(fail++,console.log('  ✗ FAIL '+l));};
const before=Buffer.from(src.buf);

console.log(`\nBEFORE  brand=${before.toString('latin1',8,12)}  edts=${before.includes(Buffer.from('edts'))}`);
const r = await faststartRemux(src, ()=>{}, { rebrand:true, stripEdits:true, zeroDuration:true });
const after = Buffer.from(await r.blob.arrayBuffer());
console.log(`AFTER   brand=${after.toString('latin1',8,12)}  edts=${after.includes(Buffer.from('edts'))}`);
console.log(`\n${r.note}\n`);

chk('moov moved to front',              r.moved===true);
chk('QuickTime rebranded to isom (TikTok muxer brand)', after.toString('latin1',8,12)==='isom');
chk('no "qt  " brand left in ftyp',     !after.subarray(0,32).includes(Buffer.from('qt  ')));
chk('edit list neutralised',            !after.includes(Buffer.from('edts')));
chk('edts became free padding',         after.includes(Buffer.from('free')));
chk('reported editsStripped=1',         r.editsStripped===1);
chk('reported rebranded=1',             r.rebranded===1);
chk('duration zeroed',                  !!r.durationZeroed);
chk('file size unchanged (lossless)',   after.length===src.size);
const m=before.indexOf(Buffer.from('mdat'))+4;
chk('media bytes byte-identical',       after.includes(before.subarray(m,m+512)));

console.log(`\n${'═'.repeat(56)}\n${fail?'❌':'✅'}  ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
