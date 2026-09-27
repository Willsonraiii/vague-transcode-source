# Vague Transcode — full project handoff

**Purpose of this document:** everything needed to continue this project with a
different assistant, with no loss of context. Read it top to bottom before
changing anything.

Last updated: 27 September 2026

---

## 1. What the project is

A tool that prepares video files before uploading them to TikTok, so the upload
keeps its intended frame rate and HDR colour.

**Personal use only.** Not a business, not for sale, no users other than the
owner. Ignore any advice about pricing, audits, wallets or monetisation — an
earlier phase of this project wrongly assumed it was commercial.

**Owner's hardware:**
- Linux Mint 22.3, Dell Inspiron 15 3552, Intel Braswell Celeron, **2 cores**
- Also a Windows machine (Edge browser)
- Phone: iPhone (files carry `major_brand: qt` + `com.apple.quicktime.creationdate`)

**GitHub:** `Willsonraiii/vague-transcode`
**Live site:** https://willsonraiii.github.io/vague-transcode/
**Local repo on Windows:** `C:\Users\Admin\Projects\original` ← note: folder name
does NOT match the repo name. This caused repeated confusion. Also: the owner
changes machines — treat GitHub, not any local checkout, as current.

---

## 2. Hard-won domain knowledge

This is the most valuable part of the document. Most of it was discovered by
testing, and several items contradict what is written on blogs and competitor
sites. **Do not re-derive these from first principles — they were verified.**

### 2.1 TikTok platform facts (verified Sept 2026)

| Fact | Evidence |
|---|---|
| TikTok re-encodes **every** upload. No exceptions. | Universal across sources |
| **TikTok ACCEPTS 4K 60 fps uploads; 120 fps content is served on-platform** | Owner-verified, Sept 2026 |
| **TikTok DELIVERS 4K 60** — a 4K60 upload shows as 4K 60 in-app; resolution and fps survive the pipeline | **First delivered-upload measurement** (owner, Sept 2026). The old "~1080p at 2–2.5 Mbps ceiling" — blogs + one old reference video — did not hold. Delivered bitrate: not yet measured |
| The downloaded post carries **HDR tags** (gallery reads "HDR 4K 60") — but in-app playback never engaged HDR on that (patched) upload | Tags surviving ≠ HDR playback. Creators' HDR posts badge + render slower (separate HDR pipeline); ours played instantly with no badge — §2.3b signature |
| **TikTok DOES support HDR playback** | It shipped a "Standard Video Playback" accessibility toggle in Sept 2025 so viewers can *dim* HDR; colorists report TikTok accepts PQ where Instagram does not |
| HDR renders on the **mobile app only** | Desktop web player never shows HDR |
| 60 fps is accepted; delivered to selected accounts | |
| **120 fps is accepted** (owner has seen 120 served on-platform) | Sept 2026 |
| "Allow high-quality uploads" is an **account setting** that applies to desktop uploads too | Profile → Menu → Settings and privacy → Content preferences |
| Without that toggle, TikTok can deliver 30 fps even from a 60 fps source | |
| **H.265 is re-encoded lossily by TikTok**; H.264 is the safer SDR codec | |
| Desktop web upload = **one** compression pass. Phone gallery upload = **two** | |
| **Studio "Only me" → flip to Everyone in the app**: community-verified to keep **60 fps · 1080p · HDR · HEVC** | Reported by multiple sites/creators (owner relayed, Sept 2026). Mechanism: desktop = file route (no gallery re-encode) + the app-side visibility flip publishes through the app pipeline. Not yet tested by us |
| Max upload: 287.6 MB mobile / **4 GB desktop web** | |

### 2.2 The Dolby Vision finding ⭐ → **REVERSED**

**Deliver as Dolby Vision, not plain HDR.** (This section originally claimed the
opposite. The reversal is real and tested — see below.)

The original reasoning: DV **profile 8.4 is an HLG base layer plus an RPU**.
All the HDR lives in the base layer; the RPU only adds dynamic metadata — so
removing the DV signalling should "lose nothing visible". The evidence was that
TikTok videos which looked correct were tagged **HDR**, not DV.

**That evidence was a misreading:** the "HDR" tag on other people's videos
describes what TikTok **delivers**, not what they **uploaded**. And when
strip-DV was briefly ON by default, **HDR stopped surviving upload**. TikTok
may use the Dolby Vision box to route a file into its HDR pipeline at all.

**Strip-DV is now OFF on every surface** — opt-in and marked "testing only":
website `#nodv`, extension `#vg-nodv`, CLI `--no-dv`.

Implementation (kept — it is genuinely lossless): rename `dvcC`/`dvvC`/`dvwC`
boxes to `free` and retag `dvh1`/`dvhe` sample entries to `hvc1`/`hev1`. Same
byte length → no chunk offsets move.

Still open: a proper A/B test (one upload with, one without) has never been
run — see §8.2.

### 2.3 The duration patch ⭐

This is what the paid services sell. Confirmed: a creator paying for a
"paid method encode" has files that show **00:00** and display **HDR**.

**What it is:** set the `mvhd` (movie header) duration to **1 tick**.
(The *other* half of the paid method is the timescale patch — §2.9, now
implemented. The duration patch is SDR-only and gallery-toxic; the timescale
method is neither.) Players,
galleries and file browsers all show `00:00`, but the track headers keep real
timing so the media is valid.

**Critical constraints, learned the hard way:**

| Do | Don't |
|---|---|
| Patch `mvhd` only | ❌ Never zero `tkhd` or `mdhd` — that made TikTok **refuse the upload** |
| Write **1 tick**, not 0 | ❌ `0` may read as "file contains no media" |
| Upload from the **phone app via Files/attach** | ❌ TikTok Studio on **desktop refuses** a patched file |

`--patch-aggressive` still exists (zeroes all three) purely for experimentation.
It is known to break uploads.

**POST-BLOCK (owner-tested, 27 Sept 2026 — TikTok update):** after the latest
update, a patched file uploaded in the app reaches the post screen but CANNOT
be posted — the post screen shows no duration for the upload (screenshot:
`…-patched.mp4`, 00:00, post blocked). The 00:00 patch is now dead on BOTH
routes (Studio refuses at upload; app refuses at post). Kept in the tool for
experimentation only. Consistent with ecosystem churn: vague-infinity's
"NOVA mode updated, updates coming" banner. **The frame-rate method (§2.9) is
unaffected — it keeps a real duration.**

**Gallery instability (owner-tested, Sept 2026):** importing a patched
(00:00) file into iOS Photos can crash the gallery — Photos force-closed
repeatedly until the file was removed. Downloads of a patched post that echo
the original also **refuse to play** in iOS players — same 1-tick cause. Apple's importer reads durations from
different MP4 boxes than its player does (documented in the wild:
toanhblab/btvn PR #40 — all-zero durations truncate "Save to Photos", and
Photos may read a different box than WebKit). Our mvhd=1-with-real-tkhd/mdhd
is milder than all-zero, but not proven safe. **Rule: patched files live in
the Files app, never in Photos.**

### 2.3b The patch and HDR are mutually exclusive ⭐⭐ — **later CONFOUNDED, block lifted**

**Tested by the owner — though the test's upload route (gallery) re-encodes the
file, so read this together with the dispute note at the end.**

Upload a duration-patched HDR file to TikTok:

- In the app it does **not render as HDR**
- But download that same post back with a third-party downloader, and the file
  **is HDR in the gallery**

So the HDR data survives TikTok's pipeline completely. What fails is
**playback**: the TikTok player will not switch into HDR mode for a file whose
movie-header duration reads 00:00. HDR playback needs valid duration metadata.

**Further weakening (owner, Sept 2026):** the creators whose posts show FULL
visible HDR in-feed also had **00:00-patched files** (confirmed by them) — so
00:00 + HDR coexist in the wild. Also: **TikTok shows no HDR tag at all** —
"badge" language in earlier notes was wrong; the signal is the VISIBLE HDR
effect on an HDR screen (+ slower first render).

**Consequences — ⚠ STATUS DISPUTED (27 Sept 2026, owner direction):**

| Content | Duration patch |
|---|---|
| HDR | ⚠ **experimental** — allowed everywhere, warning shown |
| SDR | ✅ fine |

The refusal that used to be here was built off ONE test (patched HDR → no HDR
badge in-app). That test was **confounded**: the upload went through the
gallery (§2.4 — no Files picker existed), and the gallery re-encodes. Meanwhile
creators' patched HDR files demonstrably deliver full HDR in the feed. Both
facts can't be explained by "the patch kills HDR" — so the block was lifted:
site and extension offer the patch on HDR (experimental, confound explained),
CLI proceeds with a warning (`--force-patch` kept as a compat no-op).

**The clean A/B that settles it** (§8.7): same HDR clip, (a) patch + method,
(b) method only — post both, compare badges + "Did it survive?". If (a) loses
HDR but (b) keeps it, §2.3b was real; if both keep it, the gallery route was
the killer all along.

This also proves the patch genuinely changes TikTok's behaviour — it is not
placebo. Whether it is truly incompatible with HDR is what the §8.7 A/B
settles; the confound means "incompatible" is no longer established.

**Reproduced Sept 2026** with a 4K60 Dolby Vision upload: the post's
third-party download reads **HDR 4K 60** in the gallery, while the app shows
no Dolby/HDR badge — same signature: the data survives, the player doesn't
badge it.

Supporting observation (owner, same test): creators' HDR posts in-app carry
an HDR badge and a **slower first render** — there is a separate HDR
processing/delivery path. The patched post played instantly, no badge: the
HDR path was skipped entirely. So a downloaded file's HDR tags prove *tag
survival*, not that viewers got HDR playback.

**Method note worth copying:** the owner distinguished "did the data survive"
from "does the player render it" by downloading the post back. Those look
identical from inside the app. Always check the delivered file, not the screen.

### 2.4 The Files-vs-gallery finding ⭐ — **UI contradicted, Sept 2026**

Original finding: attach the video via "Files", never from the gallery — the
photo library hands TikTok a re-encoded derivative (often 30 fps, SDR, lower
bitrate), while the Files picker passes the original bytes. RTXFury documents
the same thing.

**Update (owner, Sept 2026): the current TikTok app offers NO Files picker —
gallery only.** The file route now exists only via the iOS share sheet
(Files app → long-press → Share → TikTok), if at all. Consequences:

- A duration-patched file uploaded through the gallery is pointless — the
  gallery re-encode rebuilds the duration and strips the patch before TikTok
  ever sees it. This is the likely explanation for "the site downloaded
  quickly and the patch didn't stick": the patch **did** apply (byte-verified:
  `mvhd` = 1 tick in the output), the upload route undid it.
- What the gallery route does to HDR is **unmeasured** (§8.5).

All three surfaces now phrase the guidance as: pass the file itself (Files
picker if your app has one, otherwise the iOS share sheet); never present the
gallery as a working route for patched files; and verify whatever route you
use with the compare tool.

### 2.5 Transfer damage

The owner's first test file was **already destroyed before processing**. It read
as 4K H.264 8-bit SDR 30 fps when the phone showed HEVC 10-bit DV 60 fps.

Cause: **iPhone → Settings → Photos → Transfer to Mac or PC → "Automatic"**
silently converts HEVC to H.264 and can halve frame rate. Must be set to
**"Keep Originals"**.

Lossless transfer methods: USB copy · AirDrop · Telegram **"Send as File"** ·
Drive/Dropbox as a *file* · `python3 -m http.server 8000`.
Never: WhatsApp, Messenger, Instagram DM, Telegram "as Video", Google Photos
storage saver.

Detection heuristic implemented in `hdr-doctor.js`: a 4K file that is 8-bit
H.264 SDR is almost certainly transfer-damaged, because phones record 4K as
HEVC 10-bit.

### 2.6 4K — accepted AND delivered ⭐ (measured, with an HDR asterisk)

**Measured Sept 2026 (owner):** a 4K 60 Dolby Vision upload (patched, 00:00):

- In-app, the post shows **4K 60** — resolution and frame rate were
  delivered. The old "TikTok delivers ~1080p at 2–2.5 Mbps" ceiling —
  inherited from blog posts and one old reference video — did not hold.
- The post downloaded back (third-party downloader) reads **HDR 4K 60** in
  the gallery — HDR *tags* exist in the delivered/downloaded file.
- **But in-app playback never engaged HDR** (§2.3b): no badge, instant
  playback, while creators' HDR posts badge and render slower.

**Discriminator run (owner, Sept 2026):** downloads of posts come back mixed —
**some show 00:00 and won't play** (our own patched upload echoed back: TikTok
stores the original file and third-party downloaders can fetch it), **some
play with a normal duration** (likely TikTok's rendition). Consequences:

- The "HDR 4K 60" tag reading on a download is **unreliable** — it may be our
  own file's tags. Only a playing, normal-duration download (a genuine
  rendition) counts as evidence about TikTok's encoder.
- 1-tick files can also make iOS **players refuse playback** — patched-file
  toxicity extends beyond the gallery crash (§2.3).
- Still open: characterise a genuine rendition (codec/bitrate/tags via the
  compare tool); whether an **unpatched** HDR upload badges + HDR-renders
  in-app (§8.1) — owner has agreed to run this test.

Consequences:
- The engine accepts and preserves 4K60/120 on every surface (no forced
  downscale, no fps decimation). "Shoot 1080p, not 4K" is retired — 4K and
  60 fps delivery are real.
- **HDR delivery is NOT established** — only tag survival. Don't claim HDR
  delivery until an unpatched HDR post badges and HDR-renders in-app.
- `--1080p` (CLI) survives only as an A/B curiosity.

### 2.7 Hardware limits on the owner's laptop

From `vainfo`: `VAProfileHEVCMain : VAEntrypointVLD` only.

- **No HEVC 10-bit hardware decode** (Braswell predates it)
- **No HEVC hardware encode at all**
- `hevc_nvenc` appears in `ffmpeg -encoders` but fails — no NVIDIA driver, no NVIDIA GPU
- Result: a 10-second 4K→1080p transcode takes **~17 minutes**
- x265 is 3.5+1, which **does** support Dolby Vision params

Conclusion: on this machine, use `--remux-only`. The transcode path works but is
impractical.

### 2.8 Competitor teardown

| | Zilem Method | RTXFury | Vague (this project) |
|---|---|---|---|
| Lossless remux | ✅ | ✅ | ✅ |
| Duration patch | ❌ | ✅ | ✅ |
| Edit lists + rebrand | ✅ | ✅ | ✅ |
| **Strip DV → plain HDR** | ❌ | ❌ | ✅ |
| **Diagnosis** | ❌ | ❌ | ✅ |
| **Verify what was delivered** | ❌ | ❌ | ✅ |
| Runs client-side | ✅ | server | ✅ |
| Discord gate | yes | yes | no |

Zilem's own FAQ: *"The patcher rewrites your MP4's internal moov atom — editing
sample tables, edit lists, and timing metadata"* and *"MOV files are remuxed to
MP4 on your device."* That sentence is what told us to add edit-list
neutralisation and QuickTime rebranding.

Both headline "4K 120fps", which describes the uploaded file, not what viewers
receive. Don't copy that claim.

**vague-infinity.com (Pulse / Forge / Nova)** — checked Sept 2026: Pulse, their
browser mode, explicitly does **not** support HDR; Forge/Nova are server-GPU
encodes. The "HDR10+ / Dolby Vision" premium claims are exactly the marketing
our own audit (`_archive/nova-copy.md`) flagged: no platform ingests HDR10+
dynamic metadata, and what genuinely survives is 10-bit PQ/HLG. Our remux
already preserves PQ/HLG/DV 8.4 byte-for-byte — a server encode only adds
re-encode capability (downscale, CFR lock), which our CLI does locally.
Their example post ("latest method"): https://vt.tiktok.com/ZSbdQVqav/ —
download it back and run the compare tool before treating it as the bar.

**Forge confirmed server-side (owner screenshot, Sept 2026):** their UI shows
the user's video uploading to their server (44 MB at ~316 KB/s) behind a
Cloudflare gate + WhatsApp funnel — the exact privacy/speed cost our local
engine avoids. Notably their analyzer labelled an iPhone 4K60 H.265 file
(IMG_6334.mov) **SDR** — either a weak probe (ours reads DV 8.4/HLG/PQ) or an
SDR recording. Lesson for the goal: if the source probe says SDR, no tool can
deliver HDR — check the source with our probe first.

### 2.9 The frame-rate method (timescale patch) ⭐⭐ — IMPLEMENTED 27 Sept 2026

**This is the core of what the paid "methods" actually do**, found in the open:
`github.com/ut0ku/120fps-method` (C++ reference patcher; Zilem's FAQ describes
the same thing: "editing sample tables, edit lists, and timing metadata").

**Algorithm (read from their code, mirrored exactly in our `remux.js`):**
divide the timescale AND the duration of **every `mvhd` and every `mdhd`** by
2 (60 fps source) or 4 (120 fps). Nothing else. Consequences:

- Real-time duration (dur ÷ ts) is unchanged — **no 00:00, no gallery crash**
- Byte widths unchanged → file size identical, offsets never move → lossless
- Frame rate computed from headers now reads HALF (60 → 30 declared) while all
  samples pass through — TikTok's encoder "finds 30 fps" and decimates nothing
- Works on HDR (unlike the 1-tick duration patch, §2.3b) — creators run patched
  HDR files and their posts deliver HDR in-feed (owner: verified visually)

Owner context (Sept 2026): creators confirmed their uploaded files showed
00:00 pre-upload — so paid tools combine BOTH tricks (timescale + duration);
downloads of their posts still crash the owner's gallery, i.e. TikTok
serves/stores those files with the degenerate structure intact.

**Status: default-ON for >48 fps files on every surface** (`#method` /
`#vg-method` / `--method`). Unit suite: `test/method-test.mjs` (13 checks:
timescale halved, real duration preserved, declared fps 30, frame count
intact, DV kept, byte-identical, works with moov-move).
**First owner result (27 Sept 2026, method file):** post plays **smooth 60fps
(the method WORKS on our account)** and the **first render is slower — the HDR
pipeline ran** (previous posts played instantly = pipeline skipped). BUT the
output is "a bit brighter, not real HDR" — the owner can identify true HDR on
their screen and this isn't it. Open diagnosis, one download-back discriminates:
(a) TikTok tonemapped to SDR + brightness boost → delivered file reads bt709
8-bit; (b) real HDR format, bitrate-starved → 10-bit PQ/HLG tags + low Mbps;
(c) source was HLG not DV → check the uploaded file's tags in the compare.

### 2.10 The Studio route is THE method ⭐ (owner-corrected, Sept 2026)

**Owner correction:** the tool exists to prepare files for a **TikTok Studio
upload** — not to route people into the app's picker. App-uploaded videos
degrade (owner observation: app-route quality suffers; the processing tool
would be pointless if the app picker were the answer). **Studio — laptop
browser, or the phone's browser in desktop mode — is the route that delivers
HDR · high quality · high fps.** All surfaces now present Studio as the
primary route; phone file routes are fallbacks only.

The method (community-verified): Studio upload as **"Only me"** → open the
app → flip visibility to **Everyone**.

Multiple sites/creators report the upload route that preserves everything:

1. Upload from **TikTok Studio on desktop** with visibility **"Only me"**
2. Open the **app** → the post → switch visibility to **Everyone**

Reported result: **60 fps · 1080p · HDR · HEVC all survive** — no 30fps
conversion.

Why this matters here:
- **Desktop Studio is a FILE route** — it sidesteps the gallery problem (§2.4:
  the owner's app has no Files picker; the gallery re-encodes).
- The **app-side flip** appears to run the publish through the app pipeline —
  reconciling the old "desktop-web HDR comes back SDR" observation with HDR
  surviving this route.
- It pairs with the **frame-rate method** (§2.9): method files keep a real
  duration, so Studio's validation accepts them. (00:00-patched files are
  still refused by Studio — those stay on the phone route.)
- The old checklist line "post public, not Only me" came from phone-route-era
  advice and is now route-dependent: direct public on the phone route;
  "Only me" → flip on the Studio route.

**Open:** owner A/B — method-ticked HDR file via Studio+flip vs phone route
(§8.7). All surfaces now present this route.

---

## 3. Architecture

**One engine, four surfaces.** All four run byte-identical module code.

```
core/profiles.js     decision engine (platform matrix, fps, colour, bitrate, assessAsIs)
core/hdr-doctor.js   diagnosis rules
extension/probe.js   MP4/MOV parser, written from scratch, no dependencies
extension/remux.js   lossless container surgery
        │
        ├── site/lib/*        copies, loaded as ES modules by the website
        ├── extension/*       the browser extension (MV3)
        └── cli/vague.js      imports ../extension/remux.js + probe.js directly
```

### Files

```
core/
  profiles.js        plan(), assessAsIs(), PLATFORMS
  hdr-doctor.js      diagnose(), identifyToolchain()
  test.js            engine tests

extension/           ← load unpacked; also the source of truth for the shared modules
  manifest.json      MV3, permissions: storage + offscreen
  content.js         hold-then-release gate, panel UI
  background.js      service worker, owns the offscreen document
  offscreen.js       MediaRecorder encoder (SDR only, rarely used)
  probe.js remux.js profiles.js hdr-doctor.js
  panel.css  icon*.png

site/                ← this is the GitHub Pages repo content
  index.html         the tool: diagnose → fix → checklist → compare
  privacy.html terms.html _style.css README.md .nojekyll
  lib/               copies of the 4 engine modules
                     LIVE DEPLOY: served from the separate repo
                     Willsonraiii/vague-transcode — run ./deploy-site.sh
                     (repo root) to push site/ there. Editing site/ here
                     changes nothing for users until that runs.

cli/
  vague.js           v7 — the CLI
  app.js ui.html     local desktop app (browser UI on 127.0.0.1:4777)
  doctor.js          toolchain preflight, incl. a real DV encode test
  setup.sh setup.ps1 installers
  *.sh *.bat         launchers
  SETUP.md TIKTOK-SETUP.md
  tiktok.js          official Content Posting API, inbox-draft upload

test/
  run-all.sh         runs everything
  *-test.mjs         6 unit suites
  e2e-site.mjs       36 checks in real Chromium
  e2e-extension.mjs  21 checks, extension loaded for real
  *.mp4              synthetic fixtures

nova-server/         server pipeline spec — NOT NEEDED for personal use, ignore
docs: QUICKSTART.md TRANSFER-GUIDE.md BYPASS-ANALYSIS.md EXPERIMENT.md SPEC.md
```

### Operations the remux performs (all lossless, no offsets move)

1. **moov → front** (faststart) — rewrites `stco`/`co64` chunk offsets
2. **QuickTime → MP4** — rewrites `ftyp` major brand `qt  ` → `mp42`
3. **Edit lists** — renames `edts` → `free` so readers skip it
4. **Strip Dolby Vision** — `dvcC` → `free`, `dvh1` → `hvc1`
5. **Duration patch** — `mvhd` duration → 1 tick (opt-in)

All five keep the file byte-length identical, which is why offsets never need
recalculating and why the media data is provably untouched.

---

## 4. Test status

```
UNIT
  engine                 17 passed
  probe                  34 assertions
  remux                  12 passed
  duration patch         13 passed
  rebrand + edit lists   10 passed
  strip Dolby Vision     11 passed
  frame-rate method      13 passed

END-TO-END (real Chromium, via xvfb)
  website                56 passed
  extension              24 passed
```

Run everything: `bash test/run-all.sh`

Browser suites need:
```bash
npm i playwright-core && npx playwright install chromium
sudo apt install -y xvfb libnspr4 libnss3 libasound2t64 libatk1.0-0t64 \
  libatk-bridge2.0-0t64 libcups2t64 libgbm1 libxkbcommon0 libxcomposite1 \
  libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0
```

The extension test is the important one: it loads a fake TikTok page that logs
any file reaching its input, and asserts the file **never arrives** until the
user clicks. That is the core behaviour of the extension.

---

## 5. Bugs found and fixed — do not reintroduce

| Bug | Cause | Fix |
|---|---|---|
| Probe reported 8-bit for a 10-bit file | `hvcC` bit depth read at offset 22 (that's `numOfArrays`); correct offset is **17** | fixed, and the test fixture was wrong the same way so it had been rubber-stamping the bug |
| 4K landscape squeezed to 1080×608 | orientation-aware limits applied the wrong way round | long edge → larger limit, regardless of orientation |
| 4K DV → Reels tonemapped to SDR | HDR legality checked against **source** size instead of **output** size | scale decided before colour |
| `dovi_tool` couldn't inject via x265 | Ubuntu x265 3.5 lacks `dolby-vision-rpu` and doesn't know profile 8.4 | switched to `dovi_tool inject-rpu` **after** encoding — works with any encoder |
| "Dolby Vision was lost" false alarm | `dovi_tool info` reads an **RPU file**, not an MP4 | verify by extracting an RPU back out of the output |
| Output judder, 9.98s vs 10.00s | raw Annex B has no timestamps; ffmpeg regenerated them and lost the B-frame reorder delay | mux with **MP4Box**, which builds correct CTS/DTS tables |
| Duration patch broke uploads | zeroed `tkhd` + `mdhd` too | `mvhd` only, value **1** not 0 |
| Website "downloaded the same file" | `faststartRemux` returned early on already-faststart files, skipping the patch | early return only when there is genuinely nothing to do |
| Website patch-warning banner never appeared | `$('#patch').onchange` was assigned twice — the second assignment silently replaced the banner toggle | one combined handler; `#run` enablement now tracks both `#patch` and `#nodv` |
| Website e2e failed 2 checks after the strip-DV revert | the test still asserted the old default (strip-DV pre-ticked), so the DV fixture produced no download | test updated: asserts OFF-by-default, ticks `#nodv` explicitly; also asserts the §2.3b patch refusal |
| CLI scope errors (`ENCODER`/`GPU` undefined) | a `function main(){}` wrapper trapped the flag declarations | wrapper removed — CommonJS allows top-level `return` |

---

## 6. Things I got wrong — calibration for the next assistant

The owner corrected me repeatedly by checking real output. **Trust their
observations over documentation.**

1. **"TikTok can't do HDR"** — wrong. It can. I was reading stale spec articles.
2. **"No bypass exists"** — wrong. The duration patch is real and is what the
   paid services sell.
3. **"More metadata is better, keep Dolby Vision"** — wrong. Plain HDR renders
   better on TikTok.
4. **"Upload from desktop web, always"** — wrong for HDR. HDR needs the phone app.
5. Three parser bugs, one of which my own test agreed with because I wrote both
   from the same misreading.

Pattern: I reasoned from how systems *should* work. The owner tested how this one
*does*. When those conflict, the owner is right.

---

## 7. The recipe (current best known method)

```
1. Shoot/export 4K60 HDR or 1080p60 HDR — 4K60 delivery MEASURED on our
   account (Sept 2026: 4K60 DV upload → delivered back as 4K 60 HDR)
2. Transfer to PC losslessly (iPhone: "Keep Originals" + USB)
3. HDR file:  ./vague.sh clip.mp4 --remux-only --method   (60/120fps: timescale
   patch, §2.9 — default on the site/extension for >48 fps; keep DV, no patch)
   SDR file:  ./vague.sh clip.mp4 --remux-only --patch       (1-tick, optional)
   or the website / extension — the same rules are enforced there
4. Move back to the phone losslessly
5. Route the file: Studio (desktop) as "Only me" → flip to Everyone in the
   app (§2.10 — community-verified, keeps 60fps/HDR/HEVC), or the phone file
   route (Files picker / share sheet). The gallery re-encodes
6. "Allow high-quality uploads" ON · post public
7. DO NOT edit after posting — no sounds, trims, filters
8. Wait 30+ min · check on the phone, never desktop web
```

⚠️ If `--patch` is used, **desktop upload will be refused**. Phone + Files only.
And **never patch an HDR file** — all three surfaces now refuse it (§2.3b):
the HDR data survives TikTok's pipeline but the player won't render it as HDR.

---

## 8. Open threads

**THE GOAL (owner, Sept 2026): "HDR smooth" — visible HDR + smooth 60fps in
the TikTok feed.** Status: smooth ✅ (frame-rate method, measured), HDR
pipeline entered ✅ (slow first render), visible HDR ❌ — the last third.

**Instrument (built, Sept 2026): the A/B test kit.** Site button (HDR files)
and CLI `--kit` write three variants of the same clip:
`-A-method` (timescale method only, DV kept) · `-B-plainHDR` (method + DV
signalling stripped → plain HLG) · `-C-untouched` (original bytes). Post all
three the same way (Studio "Only me" → app flip), then read the decoder:
A-HDR = done · B-only = plain HLG required (engine default flips) · C-only =
our remux hurts (bug hunt) · none = route/source-format variables. This is
§8.4's variant generator, focused on the goal.

**A/B/C RESULT (owner, 27 Sept 2026): NO variant showed visible HDR.**
A (method, DV kept) ✗ · B (method, plain HLG) ✗ · C (untouched original) ✗.
Eliminations: our remux exonerated (C failed too) · the method exonerated ·
DV-vs-HLG made no difference. Remaining suspects, in order:
1. **Source validity** — was the probe's colour row actually Dolby Vision/HLG
   10-bit? (The Forge screenshot's file read SDR; if the tested clip was that
   one, the whole run was void.)
2. **Route** — all three went Studio "Only me" → app flip. The desktop upload
   path may flatten HDR before the flip; the flip may not re-run the app
   pipeline. UNTESTED: the phone **share-sheet** file route with a method file.
3. **Account/settings gating** — "Allow high-quality uploads" must be ON
   (Settings → Content preferences); account-level HDR ladder gating possible.

**Decision tree — one download-back of the current test post decides:**
- delivered colour = **bt709 / 8-bit** → TikTok tonemapped it. Next levers:
  source codec (HEVC DV, never H.264), 4K60 upload (better ladder), route.
- delivered = **10-bit PQ/HLG, low bitrate** → HDR IS in the stream, starved.
  Lever: 4K60 source (our account delivers 4K), higher-bitrate export.
- delivered = **10-bit but source was HLG** → try a Dolby Vision 8.4 source
  (iPhone native, or DaVinci main10 + RPU) — §2.2 says keep DV.

✅ **RESOLVED — website is live and fully current.** Verified 27 Sep 2026: all of
Files-attach guidance, 1-tick patch, plain-HDR option, compare mode, HDR→phone
routing, strip-DV / edit-list / rebrand engine code are serving from
https://willsonraiii.github.io/vague-transcode/

Remaining:

1. ✅ **FIRST DELIVERY MEASUREMENT DONE (Sept 2026)** — 4K60 delivered
   (§2.6); HDR tags survived in the download but in-app HDR never engaged.
   Two follow-ups, each one look: (a) check the duration the gallery shows on
   the downloaded post — `00:00` = downloader echoed our patched file,
   normal = TikTok's re-encode kept HDR tags; (b) post **one unpatched** HDR
   clip — if it badges + HDR-renders in-app, the patch is the only blocker
   between us and creators'-style HDR delivery.

2. **Does stripping Dolby Vision break HDR?** It was briefly ON by default and
   HDR stopped surviving. Now OFF everywhere. Two uploads — one with, one
   without — would settle it. Note the previous assistant introduced this from a
   misreading: the "HDR" tag on other people's videos describes what TikTok
   *delivers*, not what they *uploaded*.

3. ~~"TikTok's 4K downscaler is bad"~~ — **moot**: TikTok delivered our 4K60
   upload as 4K (§2.6); there is no forced 1080p downscale on this account.
   `--1080p` remains an A/B curiosity only. The delivered 4K bitrate is still
   unmeasured.

4. **Unexplored levers:** `btrt` declared bitrate, keyframe/`stss` density,
   resolution bucket edges, uploading AV1. ✅ The variant generator is BUILT in
   focused form (A/B kit, see §8 header) — extend it if these levers need
   testing.

5. **What does the gallery-only upload route actually deliver?** The app has
   no Files picker (§2.4 update). Old claim: gallery = re-encoded 30fps SDR
   derivative. Never measured on our account. One test clip posted via the
   gallery + "Did it survive?" settles it.

7. **Method + route A/B against TikTok** — same HDR clip: (a) method on,
   Studio "Only me" → app flip (§2.10); (b) method on, phone file route;
   (c) method off, control. Compare fps/HDR/HEVC with "Did it survive?".
   First real measurement of the timescale patch AND the Studio-flip route.

6b. **Nova premium diff play (owner is exploring it).** When a Nova output
   file exists: drop the ORIGINAL into "Did it survive?" slot 1 and Nova's
   OUTPUT into slot 2 — the compare table diffs their exact container changes
   (declared fps row reveals a timescale patch; colour/DV rows reveal
   strip-or-keep; edit-list/brand rows reveal the rest). Adopt anything they
   do that we don't. Their free tier offers nothing we lack (server upload,
   gated guides, SDR-only browser mode).

6. **Measure the Nova example post** — https://vt.tiktok.com/ZSbdQVqav/
   ("latest method"). Download it and run the compare tool: what resolution,
   fps and colour does it actually deliver? Our audit of their claims is in
   `_archive/nova-copy.md`; a measurement beats the marketing either way.

---

## 10. Chronological log — what was tried, in order

Kept so a new assistant doesn't repeat a dead end.

| # | What happened |
|---|---|
| 1 | Started as "rebuild this HTML page". It was **not** the owner's site — an early misread that produced irrelevant security-audit and monetisation advice. Ignore all of it. |
| 2 | Built `core/profiles.js` — the platform decision engine. Still in use. |
| 3 | Built the browser extension with a probe + panel. Worked. |
| 4 | **Owner's first test file was transfer-damaged** — the whole "it's not working" phase traced to iPhone "Automatic" transfer, not to the tools. |
| 5 | Assistant claimed TikTok can't do HDR. **Owner disproved it.** Engine corrected. |
| 6 | Assistant claimed no bypass exists. **Owner pointed at Zilem/RTXFury.** Teardown found the duration patch. |
| 7 | Tried in-browser re-encode via canvas/MediaRecorder → produced a 0.3 MB broken file, and **canvas is SDR-only so it destroys HDR**. Abandoned; kept only as an SDR fallback. |
| 8 | Built the CLI transcode path. x265 on Ubuntu **lacks `dolby-vision-rpu` and profile 8.4** → switched to `dovi_tool inject-rpu` after encoding. Works. |
| 9 | Transcode output juddered → raw Annex B has no timestamps → **mux with MP4Box**. Fixed. |
| 10 | 17 minutes for 10 seconds on the owner's 2-core laptop → concluded **shoot 1080p, use `--remux-only`**. |
| 11 | Explored TikTok Content Posting API. Direct Post needs an audit that a personal tool can't pass; inbox-draft works. Built in `cli/tiktok.js`, **never used** — no quality benefit, and the draft path adds an app-side publish step. |
| 12 | Built the website, then rebuilt it mobile-first as a real workflow. |
| 13 | Inspected competitors properly → added **edit-list neutralisation** and **QuickTime rebranding**. |
| 14 | **Owner found HDR-tagged videos look better than DV-tagged ones** → added strip-DV. Default on. |
| 15 | Duration patch broke an upload → traced to zeroing `tkhd`/`mdhd` → now `mvhd` only, value 1. |
| 16 | Owner confirmed a paying creator's file shows **00:00 + HDR** and uploads via **Files/attach on the phone** → that's the complete paid method, and the desktop/patch incompatibility is explained. |
| 17 | Installed real Chromium and wrote genuine end-to-end tests. Found two bugs — **both in the tests, not the product**. |
| 18 | **Owner verified TikTok accepts 4K 60 fps (and has seen 120 fps served)** → engine limits raised (2160×3840, 120 fps, 4K HDR), all surfaces stop warning about 4K, CLI keeps 4K by default with `--1080p` as the optional downscale. Acceptance ≠ delivery: whether our account is *served* >1080p is still unmeasured. |
| 19 | **Owner: the app has no Files picker (gallery only), and the site "downloads quickly without working/patching".** Byte-verification proved the patch DOES apply (`mvhd`=1 in the output) — the gallery route strips it after upload. Site rebuilt: new step-4 "Verified" card re-probes the output file and shows a before→after table (moov position, duration header, DV, edit list, branding, byte-identity); all upload guidance now matches gallery-only reality (share-sheet route + verify with compare tool). |
| 20 | **FIRST DELIVERY MEASUREMENT**: owner uploaded 4K60 Dolby Vision (patched) — app shows 4K 60 but no Dolby badge; the third-party download of the post reads **HDR 4K 60** in the gallery. TikTok delivers 4K60 HDR → §2.1/§2.6/§7/§8 updated, "shoot 1080p" advice retired, §2.3b signature reproduced. |
| 21 | **Owner follow-up on the 4K60 test**: patched file crashed the phone gallery (Photos force-closes; patched files now live in Files, never Photos — §2.3). Creators' HDR posts badge + render slower in-app; ours played instantly with no badge → HDR pipeline was skipped; downloaded-post HDR tags = tag survival, not playback. §2.6 downgraded from "delivers 4K60 HDR" to "delivers 4K60; HDR tags ≠ HDR playback". |---
| 22 | **Downloader echo discovered**: post downloads are mixed — some show 00:00 and won't play (our own patched upload, stored & served by TikTok), some play normally. "HDR 4K 60" tag readings on downloads are unreliable until the download plays with a normal duration. Compare tool now warns about this. Owner agreed to the decisive unpatched-HDR test (§8.1). |
| 23 | **Found and implemented the actual paid method**: ut0ku/120fps-method (open source) — divide mvhd+mdhd timescale+duration by 2/4 so TikTok's encoder reads half the fps and decimates nothing. Lossless, real duration kept, HDR-safe. Default-on for >48fps on all surfaces (`--method`/`#method`/`#vg-method`); 13-check unit suite + browser e2e. Owner context: creators' uploads showed 00:00 (paid tools combine BOTH patches); their delivered posts still crash the gallery. |### Session pause note (27 Sept 2026, late)

Owner is tired — stop designing multi-step owner-run protocols. Wins this
session are real and shipped: frame-rate method implemented + measured
working (smooth 60fps), 00:00 patch correctly retired (TikTok blocks it),
tool exonerated by the C-variant (untouched original also showed no HDR),
source confirmed HDR (kit card appeared).

**Prime remaining hypothesis (untested, cheap to check): account/region HDR
gating.** The owner SEES HDR on other creators' posts on their device
(playback works), but their own posts never render HDR regardless of file —
including their untouched original. Owner is in Nepal (region-cohort delivery
is plausible); smaller/newer accounts may also get lower processing tiers.
Next session: verify "Allow high-quality uploads" is ON (Settings → Content
preferences), then ONE simple post via the normal Fix button — no kits, no
lettered variants. If that still fails, the answer is account-side and no
file-side work will change it.

## 9. Standing preferences
| 24 | **Owner: HDR is the main target — others patch HDR, we refused it.** §2.3b block LIFTED on all surfaces (patch on HDR = experimental + confound note: the failed test went through the gallery, which re-encodes; creators' patched HDR delivers). CLI `--patch --method` on HDR now builds the full paid-method file (1-tick + timescale ÷2 + DV kept, byte-identical). Clean A/B recorded at §8.7. |
| 25 | **Studio "Only me" → flip-to-Everyone route** relayed by the owner from creator sites: desktop upload as private, flip visibility in the app — keeps 60fps/1080p/HDR/HEVC. It's a file route (no gallery re-encode) whose app-side flip reconciles the old "desktop HDR = SDR" observation; pairs with the frame-rate method (real duration passes Studio validation). All surfaces updated; checklist's "never Only me" line made route-dependent (§2.10). |- Personal use — no monetisation advice
| 26 | **Owner pre-test observations**: creators' 00:00-patched files DO show full visible HDR in-feed (00:00+HDR works in the wild); TikTok shows no HDR tag — HDR is judged by the visible effect, not a badge ("badge" wording corrected across surfaces). Owner running the Studio-flip / method test next. |- Wants real working software, not specs or mockups
| 27 | **Method's first measured result**: 60fps preserved ✅ (timescale patch works on our account), slower first render ✅ (HDR pipeline entered — previous posts skipped it), visible HDR ❌ ("a bit brighter, not HDR"). Diagnosis table recorded at §2.9 — one download-back (colour tags + bitrate) discriminates SDR-tonemap vs starved-HDR vs HLG-source. |- Wants all three surfaces at feature parity (website and extension must not lag
| 28 | **00:00 patch is dead on both routes after the TikTok update** (owner screenshot: post screen, `-patched.mp4`, no duration, can't publish). Studio already refused; now the app blocks posting. All surfaces relabel the patch "likely broken — Sept 2026 update"; frame-rate method unaffected (real duration). Matches vague-infinity's "NOVA updated" scramble. |  the CLI)
| 29 | **A/B test kit built** (site `#abkit` + CLI `--kit`): writes -A-method / -B-plainHDR / -C-untouched variants for HDR sources — the instrument that finds this account's HDR recipe in one posting session. Motivation: every prior HDR belief was confounded by the gallery route (incl. the strip-DV revert — same confound as §2.3b). Website 56/56. |- Prefers being shown the command to run over long explanations
| 30 | **A/B/C null result**: no variant (method / plain-HLG / untouched) delivered visible HDR. Tool + method + DV-vs-HLG all exonerated. Remaining: source validity, route (share sheet untested), account gating (HQ-uploads setting). Next: share-sheet test with a confirmed-HDR source. |
- Will push back hard on anything that doesn't work; take it seriously and test
  rather than explain
- **Changes machines constantly.** GitHub is the single source of truth — never
  leave work only in a local checkout, a patch file, or an agent sandbox:
  commit and push before ending a session, and `git fetch origin` before
  starting one. Don't rely on any file existing on any particular machine.
  If `site/` changed, also run `./deploy-site.sh` — the live tool is served
  from a separate repo and does not update otherwise.
