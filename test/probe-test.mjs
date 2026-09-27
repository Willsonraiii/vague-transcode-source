import { readFileSync } from 'fs';
import { probeFile } from '../extension/probe.js';

// Minimal File shim for Node
class NodeFile {
  constructor(p, name){ this.buf = readFileSync(p); this.name = name; this.size = this.buf.length; }
  slice(a, b){ const s = a<0 ? this.size+a : a; const e = b===undefined?this.size:(b<0?this.size+b:b);
    const sub = this.buf.subarray(s,e);
    return { arrayBuffer: async () => sub.buffer.slice(sub.byteOffset, sub.byteOffset+sub.byteLength) }; }
}

const EXPECT = [
  ['test/a_4k60_pq.mp4',      { width:2160, height:3840, fps:60, vfr:false, codec:'hevc', bitDepth:10,
                                colorTransfer:'smpte2084', colorPrimaries:'bt2020', hdr:true, audioCodec:'aac' }],
  ['test/b_1080p60_dv.mp4',   { width:1080, height:1920, fps:60, vfr:false, codec:'hevc', bitDepth:10,
                                hasDolbyVisionRPU:true, dvProfile:8.4, hdr:true, hdrFormat:'dolbyvision' }],
  ['test/c_capcut_broken.mp4',{ width:1080, height:1920, fps:30, codec:'h264', bitDepth:8,
                                colorPrimaries:'bt2020', colorTransfer:'bt709', hdr:true }],
  ['test/d_vfr_5994.mp4',     { width:1080, height:1920, vfr:true }],
  ['test/e_rot90.mp4',        { width:1080, height:1920, rotation:90 }],
];

let pass=0, fail=0;
for (const [path, exp] of EXPECT) {
  const r = await probeFile(new NodeFile(path, path.split('/').pop()));
  console.log(`\n▸ ${path}`);
  console.log(`  ${r.width}×${r.height} @ ${r.fps}fps${r.vfr?' VFR':' CFR'} · ${r.codec} ${r.bitDepth}-bit · ` +
              `${r.colorPrimaries}/${r.colorTransfer} · ${r.hdr?'HDR '+(r.hdrFormat||''):'SDR'}` +
              (r.audioCodec?` · audio ${r.audioCodec}`:''));
  for (const [k,v] of Object.entries(exp)) {
    const got = r[k];
    if (got === v) { pass++; }
    else { fail++; console.log(`     ✗ ${k}: expected ${v}, got ${got}`); }
  }
  if (r._debug.warnings.length) console.log('     warnings:', r._debug.warnings.join('; '));
}
console.log(`\n${'═'.repeat(66)}`);
console.log(`${fail===0?'✅':'❌'}  ${pass} assertions passed, ${fail} failed`);
process.exit(fail?1:0);
