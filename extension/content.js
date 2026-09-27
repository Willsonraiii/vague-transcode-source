/**
 * Vague Guard — content script (hold-then-release architecture)
 *
 * The problem with the naive approach: selecting a file fires `change`, TikTok
 * immediately starts uploading, and anything we do afterwards is a race we can
 * lose — the original may already be on their servers.
 *
 * So we intercept in the CAPTURE phase, which runs before the page's own
 * handlers. We stop the event, clear the input so TikTok cannot read it, and
 * hold the file. Nothing uploads. Only when the user picks an action do we put
 * a file back and re-dispatch — and that file is marked, so we let it through.
 *
 *   select ──▶ [CAPTURE: block, clear input, hold] ──▶ analyse
 *                                                        │
 *                             ┌──────────────────────────┤
 *                             ▼                          ▼
 *                    upload original as-is      fix, then release
 *                             └──────────┬───────────────┘
 *                                        ▼
 *                        set input.files + dispatch change ──▶ TikTok uploads
 */

(async () => {
  'use strict';

  const { probeFile }  = await import(chrome.runtime.getURL('probe.js'));
  const { diagnose, identifyToolchain } = await import(chrome.runtime.getURL('hdr-doctor.js'));
  const { plan }       = await import(chrome.runtime.getURL('profiles.js'));
  const { faststartRemux } = await import(chrome.runtime.getURL('remux.js'));

  const PLATFORM = location.hostname.includes('instagram') ? 'ig_reels' : 'tiktok';
  const UPLOAD_PATH = 'web';
  const VIDEO_RE = /\.(mp4|mov|m4v|mkv|webm)$/i;

  let panel = null;
  let held = null;          // { file, input }
  let analysis = null;      // { probe, dx, p }

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const isVideo = f => f && (/video\//.test(f.type || '') || VIDEO_RE.test(f.name || ''));

  /* ===================================================== INTERCEPTION ==== */

  const nativeFilesSetter =
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files').set;

  /** Put a file back and let it through to the page. */
  function release(blob, name) {
    const input = held?.input || document.querySelector('input[type=file]');
    if (!input) throw new Error('Upload field not found — please re-select the file.');

    const f = new File([blob], name, { type: blob.type || 'video/mp4' });
    f.__vagueReleased = true;                    // our marker: do not re-intercept

    const dt = new DataTransfer();
    dt.items.add(f);
    nativeFilesSetter.call(input, dt.files);

    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return f;
  }

  /** CAPTURE-phase gate. Runs before TikTok's handlers. */
  function onChangeCapture(e) {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'file') return;
    const f = t.files && t.files[0];
    if (!f || !isVideo(f)) return;
    if (f.__vagueReleased) return;               // our own file — let it upload

    // Stop the page from ever seeing this selection.
    e.stopImmediatePropagation();
    e.preventDefault();

    held = { file: f, input: t };
    try { nativeFilesSetter.call(t, new DataTransfer().files); } catch { t.value = ''; }

    analyse(f);
  }

  /** Drag-and-drop takes a different path — gate it too. */
  function onDropCapture(e) {
    const f = e.dataTransfer?.files?.[0];
    if (!f || !isVideo(f) || f.__vagueReleased) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    held = { file: f, input: document.querySelector('input[type=file]') };
    analyse(f);
  }

  document.addEventListener('change', onChangeCapture, true);
  document.addEventListener('drop',   onDropCapture,   true);

  /* =========================================================== PANEL ===== */

  function ensurePanel() {
    if (panel && document.body.contains(panel)) return panel;
    panel = document.createElement('div');
    panel.id = 'vague-guard';
    panel.innerHTML = `
      <div class="vg-head">
        <span class="vg-logo">V</span><strong>Vague Guard</strong>
        <button class="vg-close" title="Hide">×</button>
      </div>
      <div class="vg-body"><div class="vg-idle">Select a video — upload is held until you choose.</div></div>`;
    panel.querySelector('.vg-close').onclick = () => panel.remove();
    document.body.appendChild(panel);
    return panel;
  }
  const body = () => panel.querySelector('.vg-body');

  function row(state, label, value, note) {
    const icon = { ok:'✓', warn:'!', bad:'✗' }[state];
    return `<div class="vg-row vg-${state}"><span class="vg-icon">${icon}</span>
      <span class="vg-label">${esc(label)}</span><span class="vg-value">${esc(value)}</span>
      ${note ? `<div class="vg-note">${esc(note)}</div>` : ''}</div>`;
  }

  function rawDump(pr) {
    const L = [];
    L.push(`file      ${pr.fileName}  (${pr.fileSizeMB} MB)`);
    L.push(`brand     ${pr.brand||'?'}   faststart ${pr.moovAtEnd?'NO':'yes'}`);
    L.push(`video     ${pr.width}x${pr.height}  rot ${pr.rotation}deg  ${pr.codec||'?'}  ${pr.bitDepth}-bit`);
    L.push(`timing    ${pr.fps} fps  ${pr.vfr?'VFR':'CFR'}  ${pr.frameCount} frames  ${pr.durationSec}s`);
    L.push(`colr box  primaries=${pr.colorPrimaries??'ABSENT'}  transfer=${pr.colorTransfer??'ABSENT'}`);
    L.push(`          matrix=${pr.colorMatrix??'ABSENT'}  range=${pr.colorRange}`);
    L.push(`dolby     RPU=${pr.hasDolbyVisionRPU?'yes profile '+pr.dvProfile:'none'}`);
    L.push(`verdict   ${pr.hdr?'HDR ('+(pr.hdrFormat||'?')+')':'SDR'}`);
    L.push(`bitrate   ${pr.bitrateMbps} Mbps   audio ${pr.audioCodec||'?'}`);
    L.push('');
    L.push('tracks:');
    for (const t of pr._debug.tracks)
      L.push(`  [${t.kind||'?'}] ${t.dims||'-'} ts=${t.timescale} frames=${t.frames} ${t.codec||''}`);
    if (pr._debug.warnings.length) L.push('', 'warnings: ' + pr._debug.warnings.join(' | '));
    return L.join('\n');
  }

  /* ========================================================= ANALYSE ===== */

  async function analyse(file) {
    ensurePanel();
    body().innerHTML = `<div class="vg-held">⏸ Upload held</div>
      <div class="vg-idle">Scanning ${esc(file.name)}…</div>`;
    try {
      const probe = await probeFile(file);
      const dx = diagnose(probe);
      const p = plan({ ...probe, sizeMB: probe.fileSizeMB, path: file.name },
                     PLATFORM, { uploadPath: UPLOAD_PATH });
      analysis = { probe, dx, p };
      console.log('[Vague Guard]', { probe, diagnosis: dx, plan: p });
      render();
    } catch (err) {
      body().innerHTML = `<div class="vg-held">⏸ Upload held</div>
        <div class="vg-idle">Could not parse this file.<br><small>${esc(err.message)}</small></div>`;
      addActions(true);
    }
  }

  function render() {
    const { probe, dx, p } = analysis;
    const o = p.output;
    const asIs = p.asIs || { verdict:'reencode', recommended:false, blockers:[], reasons:[] };
    const rows = [];

    const resChanged = probe.width !== o.width || probe.height !== o.height;
    rows.push(row(resChanged ? 'warn' : 'ok', 'Resolution',
      `${probe.width}×${probe.height}${resChanged ? ` → ${o.width}×${o.height}` : ''}`,
      resChanged ? p.decisions.scale.reason : null));

    if (probe.vfr) rows.push(row('bad','Frame rate',`${probe.fps} fps VFR`,
      `Variable frame rate — the platform will re-time this. Locking to ${o.fps} fps CFR fixes it.`));
    else rows.push(row('ok','Frame rate',`${probe.fps} fps`,'Preserved exactly.'));

    rows.push(row('ok','Codec', probe.codec || 'unknown'));

    for (const f of dx.findings) {
      if (f.severity === 'ok') continue;
      const val = f.code === 'NO_FASTSTART' ? 'moov at end'
                : f.code === 'TRANSFER_DAMAGE' ? `${probe.codec} ${probe.bitDepth}-bit`
                : `${dx.detected.transfer} / ${dx.detected.bitDepth}-bit`;
      rows.push(row(f.severity === 'critical' ? 'bad' : 'warn', f.title, val, `${f.symptom} — ${f.fix}`));
    }
    if (!dx.findings.some(f => f.severity !== 'ok'))
      rows.push(row('ok','Colour', probe.hdr ? `HDR ${probe.hdrFormat||''} correctly tagged` : 'SDR correctly tagged'));

    rows.push(row('ok','Bitrate', `${probe.bitrateMbps ?? '?'} Mbps`));
    if (probe.isQuickTime) rows.push(row('warn','QuickTime branding','qt',
      'Not a standard MP4. Relabelled on fix — no re-encode.'));
    if (probe.hasEditList) rows.push(row('warn','Edit list','elst',
      'Can shift playback start or drift audio. Neutralised on fix.'));

    const tool = identifyToolchain(probe);
    const bad = dx.criticalCount + (probe.vfr ? 1 : 0);
    const fmt = probe.hdrFormat === 'dolbyvision' ? 'Dolby Vision' : probe.hdr ? 'HDR' : 'quality';

    body().innerHTML = `
      <div class="vg-held">⏸ Upload held — nothing sent yet</div>
      <div class="vg-verdict vg-v-${bad ? 'bad' : asIs.recommended ? 'best' : 'ok'}">
        ${bad ? `${bad} issue${bad>1?'s':''} will cost you quality`
              : asIs.recommended ? '★ This file is already optimal' : 'This file is upload-ready'}
      </div>
      ${probe.hdr ? `<div class="vg-asis"><b>${esc(fmt)} detected.</b>
        <div class="vg-sub">${probe.bitDepth}-bit · ${probe.fps} fps · ${probe.bitrateMbps} Mbps.
        Choose a lossless action to keep all of it.</div></div>` : ''}
      ${tool ? `<div class="vg-tool">🔍 Likely source: <b>${esc(tool.likely)}</b><br>${esc(tool.advice)}</div>` : ''}
      <div class="vg-rows">${rows.join('')}</div>
      <div class="vg-actions"></div>
      <div class="vg-hint">Runs on your machine. Upload starts only when you choose.</div>
      <details class="vg-cmd"><summary>Show ffmpeg command</summary><code>ffmpeg ${esc(p.ffmpeg.join(' '))}</code></details>
      <details class="vg-cmd vg-raw"><summary>Raw probe — what the file actually says</summary><code>${esc(rawDump(probe))}</code></details>`;

    addActions(false);
  }

  /* ========================================================= ACTIONS ===== */

  function addActions(parseFailed) {
    const host = panel.querySelector('.vg-actions') || body();
    const probe = analysis?.probe, p = analysis?.p;
    const asIs = p?.asIs || {};
    const needsRemux = asIs.verdict === 'remux';
    const hdrLock = probe?.hdr && asIs.hdrPreserved;
    const fmt = probe?.hdrFormat === 'dolbyvision' ? 'Dolby Vision' : 'HDR';

    const btns = [];
    if (!parseFailed)
      btns.push(`<button class="vg-fix vg-lossless" data-act="remux">
        ⚡ ${needsRemux ? 'Fix container' : 'Optimize container'} &amp; upload — lossless, keeps ${esc(fmt)}</button>`);

    btns.push(`<button class="vg-fix ${needsRemux||parseFailed?'vg-secondary':'vg-lossless'}" data-act="asis">
      ${needsRemux ? 'Upload original unchanged' : '⬆ Upload — nothing needs fixing'}</button>`);

    if (!parseFailed)
      btns.push(`<button class="vg-fix vg-secondary" data-act="encode" ${hdrLock?'data-hdr="1"':''}>
        Re-encode first${hdrLock ? ' (loses HDR)' : ''}</button>`);

    if (!parseFailed && probe?.fps > 48) btns.push(`<label class="vg-opt" style="background:#eef7ff">
      <input type="checkbox" id="vg-method" checked> <b>60/120 fps method</b> (recommended)
      <span>Divides the container timescale by ${probe.fps > 90 ? 4 : 2} so TikTok's encoder reads
      ${Math.round(probe.fps / (probe.fps > 90 ? 4 : 2))} fps and decimates nothing — the full
      ${probe.fps} fps frame count survives (the ut0ku/Zilem-style timescale patch). Lossless,
      keeps real duration (no 00:00) and HDR. Local players may report the halved rate — expected.</span></label>`);
    if (!parseFailed && probe?.hasDolbyVisionRPU) btns.push(`<label class="vg-opt" style="background:#eaf6ff">
      <input type="checkbox" id="vg-nodv"> <b>Strip Dolby Vision</b> (off — testing only)
      <span>⚠ Leave OFF. HDR stopped surviving upload while this was on — TikTok may need the
      Dolby Vision box to treat the file as HDR at all.</span></label>`);
    if (!parseFailed) btns.push(`<label class="vg-opt" style="background:#fff3d6">
      <input type="checkbox" id="vg-zero"> <b>Duration patch</b> <b>(likely broken — Sept 2026 TikTok update)</b>
      <span>⚠ Owner-tested after the update: the app's post screen shows no duration and the post
      cannot be published. Prefer the 60/120 fps method — it keeps a real duration.
      Also: a patched file CANNOT be uploaded here — TikTok Studio on desktop refuses it.
      Use it only if you will move the file to your phone and pass the file itself —
      the Files picker if your app has one, or the iOS share sheet (Files app → Share → TikTok).
      The gallery re-encodes it and rebuilds the duration. And keep patched files OUT of
      iOS Photos — a 00:00 file can crash the gallery (tested). Store it in the Files app.
      Shows 00:00, which is expected.${probe?.hdr ? '<br><br>⚠ On HDR: our one patched-HDR test did not render HDR in-app — but it went through the gallery (re-encodes), so it was confounded. Creators&rsquo; patched HDR files do deliver HDR. Test once on your account.' : ''}</span></label>`);

    btns.push(`<button class="vg-fix vg-cancel" data-act="cancel">Cancel</button>`);
    host.innerHTML = btns.join('');

    host.querySelectorAll('button').forEach(b => {
      b.onclick = () => ({ remux: doRemux, asis: doAsIs, encode: doEncode, cancel: doCancel }[b.dataset.act])(b);
    });
  }

  function finish(btn, label) {
    btn.textContent = label;
    panel.querySelector('.vg-held').textContent = '▶ Uploading to TikTok…';
    panel.querySelector('.vg-held').classList.add('vg-going');
    panel.querySelectorAll('.vg-actions button').forEach(b => b.disabled = true);
  }

  function doAsIs(btn) {
    try {
      release(held.file, held.file.name);
      finish(btn, `✓ Sent original — ${held.file.size / 1048576 | 0} MB`);
    } catch (e) { alert(e.message); }
  }

  async function doRemux(btn) {
    btn.disabled = true;
    const orig = btn.textContent;
    try {
      const zero = !!panel.querySelector('#vg-zero')?.checked;
      const meth = !!panel.querySelector('#vg-method')?.checked;
      const div = meth ? (analysis.probe.fps > 90 ? 4 : analysis.probe.fps > 48 ? 2 : 0) : 0;
      const r = await faststartRemux(held.file,
        (pct, label) => { btn.textContent = `${label}… ${pct}%`; },
        { zeroDuration: zero, rebrand: true, stripEdits: true,
          stripDV: !!panel.querySelector('#vg-nodv')?.checked, fpsGuard: div });
      const name = held.file.name.replace(/\.[^.]+$/, '') + (zero ? '-patched.mp4' : '-faststart.mp4');
      release(r.blob, name);
      finish(btn, `✓ Lossless — ${(r.blob.size / 1048576).toFixed(1)} MB sent`);
      const v = panel.querySelector('.vg-verdict');
      v.className = 'vg-verdict vg-v-best';
      const bits = [];
      if (r.moved) bits.push('moov moved');
      if (r.rebranded) bits.push('rebranded MP4');
      if (r.editsStripped) bits.push('edit list stripped');
      if (r.dvStripped && r.dvStripped.boxes) bits.push('delivered as plain HDR');
      if (r.durationZeroed) bits.push('duration patched');
      if (r.fpsGuarded && (r.fpsGuarded.mvhd || r.fpsGuarded.mdhd))
        bits.push(`frame-rate method ÷${r.fpsGuarded.divider} — ${Math.round(analysis.probe.fps / r.fpsGuarded.divider)} fps declared, ${analysis.probe.fps} fps samples intact`);
      v.textContent = `★ ${bits.join(' · ')}. ${analysis.probe.hdrFormat === 'dolbyvision' ? 'Dolby Vision' : 'Quality'} fully preserved.`;
    } catch (err) {
      btn.disabled = false; btn.textContent = orig;
      alert('Could not remux:\n\n' + err.message + '\n\nYour original is untouched — use "Upload original unchanged".');
    }
  }

  async function doEncode(btn) {
    const { probe, p } = analysis;
    if (btn.dataset.hdr === '1') {
      const fmt = probe.hdrFormat === 'dolbyvision' ? 'Dolby Vision 8.4' : 'HDR';
      if (!confirm(
        `STOP — this would make your video WORSE.\n\n` +
        `Your file is ${fmt}, ${probe.bitDepth}-bit, ${probe.fps}fps, ${probe.bitrateMbps} Mbps.\n` +
        `TikTok supports HDR and will play it correctly as it is.\n\n` +
        `A browser canvas is SDR-only, so re-encoding here flattens HDR and drops ` +
        `the Dolby Vision metadata.\n\nContinue anyway and lose HDR?`)) return;
    }
    btn.disabled = true;
    const orig = btn.textContent;
    try {
      const blobUrl = URL.createObjectURL(held.file);
      btn.textContent = 'Encoding… 0%';
      const res = await chrome.runtime.sendMessage({
        target: 'vg-background', type: 'transcode',
        payload: { blobUrl, plan: p, jobId: Date.now() },
      });
      if (!res?.ok) throw new Error(res?.error || 'Encoder did not respond');

      const blob = new Blob([new Uint8Array(res.buf)], { type: res.type || 'video/mp4' });
      const expectMB = (p.output.targetMbps * (probe.durationSec || 1)) / 8;
      if (blob.size / 1048576 < Math.max(0.5, expectMB * 0.25))
        throw new Error(`Encoder produced only ${(blob.size/1048576).toFixed(1)} MB (expected ~${expectMB.toFixed(0)} MB).\n\n` +
          `The browser could not decode this codec — common with 10-bit HEVC / Dolby Vision.\n\nYour original is untouched.`);

      release(blob, held.file.name.replace(/\.[^.]+$/, '') + '-vague.mp4');
      finish(btn, `✓ Re-encoded — ${(blob.size / 1048576).toFixed(1)} MB sent`);
    } catch (err) {
      btn.disabled = false; btn.textContent = orig;
      alert('Could not re-encode:\n\n' + err.message);
    }
  }

  function doCancel() {
    held = null; analysis = null;
    body().innerHTML = `<div class="vg-idle">Cancelled. Nothing was uploaded.<br>Select a video to start again.</div>`;
  }

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.target === 'vg-content' && msg.stage) {
      const b = panel?.querySelector('[data-act="encode"]');
      if (b && !b.disabled === false) b.textContent = msg.stage === 'done' ? 'Finishing…' : `Encoding… ${Math.round(msg.pct||0)}%`;
    }
  });

  new MutationObserver(() => {
    if (document.querySelector('input[type=file]') && !document.getElementById('vague-guard')) ensurePanel();
  }).observe(document.documentElement, { childList: true, subtree: true });

  ensurePanel();
  console.log('[Vague Guard] armed — uploads are held until you choose.', PLATFORM);
})();
