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
| Delivery ceiling is **1080p at ~2–2.5 Mbps** | Multiple sources + a reference video |
| **TikTok DOES support HDR playback** | It shipped a "Standard Video Playback" accessibility toggle in Sept 2025 so viewers can *dim* HDR; colorists report TikTok accepts PQ where Instagram does not |
| HDR renders on the **mobile app only** | Desktop web player never shows HDR |
| 60 fps is accepted; delivered to selected accounts | |
| "Allow high-quality uploads" is an **account setting** that applies to desktop uploads too | Profile → Menu → Settings and privacy → Content preferences |
| Without that toggle, TikTok can deliver 30 fps even from a 60 fps source | |
| **H.265 is re-encoded lossily by TikTok**; H.264 is the safer SDR codec | |
| Desktop web upload = **one** compression pass. Phone gallery upload = **two** | |
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

**What it is:** set the `mvhd` (movie header) duration to **1 tick**. Players,
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

### 2.3b The patch and HDR are mutually exclusive ⭐⭐

**Tested by the owner, and the most precise finding in the project.**

Upload a duration-patched HDR file to TikTok:

- In the app it does **not render as HDR**
- But download that same post back with a third-party downloader, and the file
  **is HDR in the gallery**

So the HDR data survives TikTok's pipeline completely. What fails is
**playback**: the TikTok player will not switch into HDR mode for a file whose
movie-header duration reads 00:00. HDR playback needs valid duration metadata.

**Consequences:**

| Content | Duration patch |
|---|---|
| HDR | ❌ never — you lose HDR rendering |
| SDR | ✅ fine |

All three surfaces refuse the patch on HDR files: the CLI exits unless
`--force-patch` (or `--sdr` on the **transcode** path, where the output really
is SDR — a remux copies streams, so `--sdr` rescues nothing there); the website
disables the checkbox with an explanation; the extension replaces the option
with a note.

This also proves the patch genuinely changes TikTok's behaviour — it is not
placebo. It is simply incompatible with HDR.

**Method note worth copying:** the owner distinguished "did the data survive"
from "does the player render it" by downloading the post back. Those look
identical from inside the app. Always check the delivered file, not the screen.

### 2.4 The Files-vs-gallery finding ⭐

**In the TikTok app, attach the video via "Files", never from the gallery.**

Picking from the photo library makes the OS hand TikTok a re-encoded derivative
— often 30 fps, SDR, lower bitrate. The Files picker passes the original bytes.
RTXFury documents the same thing. This is free and is one of the biggest levers.

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

### 2.6 The 4K trap

TikTok delivers 1080p. Shooting/exporting 4K means someone downscales:

| Who | Cost |
|---|---|
| TikTok's server | fast, low-quality filter |
| The CLI | good Lanczos — but **17 minutes** on the owner's 2-core laptop |
| **The editor, on export** | good filter, free — the render was happening anyway |

**Recommendation: shoot/export 1080p60 HDR.** Then the whole job is a ~1 second
lossless remux. A reference video the owner admired was delivered at 1080p.

⚠️ Note: "TikTok's downscaler is bad" came from blog posts and has **never been
measured**. If someone wants a real experiment, this is a good one.

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
  engine                 14 passed
  probe                  34 assertions
  remux                  12 passed
  duration patch         13 passed
  rebrand + edit lists   10 passed
  strip Dolby Vision     11 passed

END-TO-END (real Chromium, via xvfb)
  website                38 passed
  extension              23 passed
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
1. Shoot/export 1080p60 HDR — not 4K
2. Transfer to PC losslessly (iPhone: "Keep Originals" + USB)
3. HDR file:  ./vague.sh clip.mp4 --remux-only        (keep DV, no patch)
   SDR file:  ./vague.sh clip.mp4 --remux-only --patch   (patch optional)
   or the website / extension — the same rules are enforced there
4. Move back to the phone losslessly
5. TikTok app → +  → "Files" / attach     ← NEVER the gallery
6. "Allow high-quality uploads" ON · post public
7. DO NOT edit after posting — no sounds, trims, filters
8. Wait 30+ min · check on the phone, never desktop web
```

⚠️ If `--patch` is used, **desktop upload will be refused**. Phone + Files only.
And **never patch an HDR file** — all three surfaces now refuse it (§2.3b):
the HDR data survives TikTok's pipeline but the player won't render it as HDR.

---

## 8. Open threads

✅ **RESOLVED — website is live and fully current.** Verified 27 Sep 2026: all of
Files-attach guidance, 1-tick patch, plain-HDR option, compare mode, HDR→phone
routing, strip-DV / edit-list / rebrand engine code are serving from
https://willsonraiii.github.io/vague-transcode/

Remaining:

1. ✅ **PARTLY DONE** — the owner posted a patched HDR file, downloaded it back,
   and found the HDR intact in the file but not rendered in the app. See §2.3b.
   Still unmeasured: an **unpatched** HDR upload. Does it render as HDR in the
   app? That is now the single most useful test.

2. **Does stripping Dolby Vision break HDR?** It was briefly ON by default and
   HDR stopped surviving. Now OFF everywhere. Two uploads — one with, one
   without — would settle it. Note the previous assistant introduced this from a
   misreading: the "HDR" tag on other people's videos describes what TikTok
   *delivers*, not what they *uploaded*.

3. **"TikTok's 4K downscaler is bad" is unverified.** It came from blog posts and
   was repeated by the previous assistant. If it turns out to be fine, the entire
   4K→1080p transcode path becomes unnecessary.

4. **Unexplored levers:** `btrt` declared bitrate, keyframe/`stss` density,
   resolution bucket edges, uploading AV1. A variant generator (one field changed
   per file, post them all, compare) was proposed but never built.

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

---

## 9. Standing preferences

- Personal use — no monetisation advice
- Wants real working software, not specs or mockups
- Wants all three surfaces at feature parity (website and extension must not lag
  the CLI)
- Prefers being shown the command to run over long explanations
- Will push back hard on anything that doesn't work; take it seriously and test
  rather than explain
- **Changes machines constantly.** GitHub is the single source of truth — never
  leave work only in a local checkout, a patch file, or an agent sandbox:
  commit and push before ending a session, and `git fetch origin` before
  starting one. Don't rely on any file existing on any particular machine.
