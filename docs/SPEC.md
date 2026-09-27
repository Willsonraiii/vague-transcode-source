# Vague HD — Technical Spec & Build Plan

**Goal (precise wording, use this everywhere):**
> Maximum surviving quality. HDR preserved where the platform can carry it, a
> controlled high-quality SDR conversion where it can't, and **exported frame
> rate preserved exactly** — 60 in, 60 out.

Not "no quality loss." Every platform re-encodes 100% of uploads. Claiming
otherwise is the fastest way to lose credibility with the exact audience
(editors, colorists) who would pay you.

---

## 1. Platform reality — September 2026

| | TikTok | IG Reels | IG Story | YT Shorts |
|---|---|---|---|---|
| Max delivery | 1080p | 1080p | 1080p | 1080p |
| Max fps | 60¹ | 60 | 30 | 60 |
| HDR ingest | **none** | **DV 8.4, iOS app only** | none | HDR10/HLG |
| Delivery codec | H.264 | AV1 / VP9 / H.264 | H.264 | H.264/VP9 |
| Delivery bitrate | ~2–2.5 Mbps | ~3–5 Mbps | ~2 Mbps | ~4–6 Mbps |
| Max upload | 287.6 MB mobile / 4 GB web | 4 GB | 4 GB | 256 GB |

¹ 60fps is delivered to select/high-engagement accounts; upload at 60 regardless.

**Three facts that define the product:**

1. **HDR10+ has no ingest path on any social platform.** Must be converted to
   DV 8.4 or HLG. Tell the user this plainly — nobody else does.
2. **Instagram's Dolby Vision is iOS-app-only.** Meta shipped DV Profile 8.4 +
   `amve` preservation Nov 2025, delivering as DV Profile 10 inside AV1. Not
   Android, not web. VP9 deliveries drop DV entirely (no metadata carriage).
3. **4K is never delivered anywhere.** Downscale to 1080p yourself with Lanczos;
   the platform will do it worse.

---

## 2. Why frame rate is the killer feature

This is your actual differentiator and nobody markets it. Four separate bugs
cause "I exported 60fps and TikTok gave me 30":

| Cause | Fix (implemented in `core/profiles.js`) |
|---|---|
| **VFR source** — iPhone footage is variable frame rate; platform encoders re-time it | Force `-fps_mode cfr` at the *source's own rate* |
| **59.94 rounded to 60** — inserts duplicate frames, causes micro-judder | Snap to 3 decimals, never round across |
| **Ragged decimation** — 120→60 by dropping uneven frames | Integer divisor only (÷2, ÷3, ÷4) |
| **Preset hardcodes 30** — most tools ship a single "TikTok preset" | fps is derived per-file, never fixed |

Marketing line: **"Your 60fps export stays 60fps. We can prove it — check the
output before and after."**

---

## 3. Architecture: one core, five surfaces

```
              ┌──────────────────────────────┐
              │   core/  (Rust crate)        │
              │  probe → plan() → ffmpeg argv│
              │  ← the entire product        │
              └──────────────┬───────────────┘
      ┌──────────┬───────────┼───────────┬──────────────┐
   wasm32     wasm32       native      FFI/static     native
      │          │           │            │              │
   Web app   Extension   Desktop       iOS app        Forge
   (Pulse)   (Chrome/FF) (Tauri)     (share ext)     (server)
      │          │           │            │              │
   SDR only  SDR only    SDR + HDR    HDR/DV 8.4    SDR + HDR
                         4K120 fast    ★ FLAGSHIP    heavy jobs
```

`core/profiles.js` in this repo is the **reference implementation**. Port it to
Rust verbatim (the logic is pure, no I/O) and compile everywhere. Do not rewrite
the decision logic per platform — that's how the three surfaces drift apart.

### Why iOS is mandatory, not optional
Your HDR/Dolby Vision goal is **physically unreachable from a browser.** DV 8.4
output needs VideoToolbox, and Instagram only ingests HDR through its iOS app.
If HDR matters, iOS is the flagship and everything else is the SDR tier.
Build it as a **Share Sheet extension** — user hits Share → Vague HD → the
transcoded file lands straight in the IG composer. Zero friction, and it's the
only correct path.

### What the browser extension is actually for
Intercept the `<input type="file">` on `tiktok.com/upload` and
`instagram.com/create`, transcode in-page, substitute the File object before
submit. The user never learns a new workflow. Web upload also gives a 4 GB
ceiling vs 287.6 MB on mobile — more headroom for a high-bitrate pre-master.
This is the highest-retention surface. Ship it second.

---

## 4. Build order (do not reorder)

**Phase 1 — Prove the claim (2–3 weeks)**
- Port `plan()` to Rust; wire to FFmpeg.
- **Build the Checker first, not the encoder.** A tool that reads any video and
  reports resolution/fps/VFR/codec/HDR format/bitrate. Free, no signup.
  It costs little, ranks for a dozen queries, and every user who runs it on a
  post-upload download *sees the problem you solve*. That's your funnel.
- Desktop (Tauri) as the first encoder — no wasm perf ceiling, no app review.

**Phase 2 — The flagship (4–6 weeks)**
- iOS app + Share extension, VideoToolbox, DV 8.4 passthrough.
- This is the only HDR path. It's also the only thing here that's genuinely hard
  to copy.

**Phase 3 — Reach**
- Browser extension (file interception).
- Web/Pulse via wasm as the free zero-install tier.
- Forge server only when client-side provably isn't enough. It's your only real
  cost centre — don't lead with it.

---

## 5. Validation you must ship (this *is* the marketing)

After every transcode, show a diff table:

```
                 SOURCE            OUTPUT           TIKTOK SAYS
Resolution       3840×2160    →    1080×1920        1080×1920  ✓
Frame rate       59.94 VFR    →    59.94 CFR        59.94      ✓  ← the win
Color            PQ / DV 8.4  →    BT.709 SDR       BT.709     ✓
Bitrate          184 Mbps     →    14.1 Mbps        2.3 Mbps
```

That third column — re-probing the file *after* downloading it back from the
platform — is the single most persuasive thing you can build. It turns an
invisible claim into a screenshot people post. Nobody in this niche does it.

---

## 6. Positioning

The current site's honesty is an asset — keep it:
> *"Hasil akhir tetap bergantung pada sumber video dan kompresi platform tujuan."*

Lead with the two claims you can actually prove:
1. **"Your frame rate survives."** (verifiable, unique, currently broken everywhere)
2. **"HDR that doesn't look washed out."** (either real DV on iOS, or a proper
   BT.2390 tonemap instead of the platform's clip)

Drop `4K 120fps` from the headline — neither survives, and an editor who knows
that will distrust everything else on the page. Replace with
**"60fps in, 60fps out. Verified."**

---

## 7. Known risks

- **Platform specs shift silently.** Keep the capability matrix as remote config,
  not a hardcoded build. Re-verify quarterly with the Checker.
- **`-dolbyvision 1` in libx265 requires an RPU-aware build.** On iOS use
  VideoToolbox instead; on desktop ship a verified FFmpeg build.
- **ffmpeg.wasm on 4K60 is brutally slow.** Gate Pulse to ≤1080p60 and be
  upfront; route heavier jobs to Desktop or Forge.
- **Extension review.** Chrome Web Store dislikes broad host permissions —
  request only `tiktok.com` and `instagram.com`, justify in the listing.
