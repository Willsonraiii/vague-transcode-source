# Vague Transcode

Prepare a video before uploading it to TikTok, so the upload keeps the frame
rate and HDR colour you exported.

Runs entirely on your own device. No server, no account, no uploads to anyone.

**Live tool:** https://willsonraiii.github.io/vague-transcode/

---

## 🤖 If you are an AI assistant

Read **[`HANDOFF.md`](HANDOFF.md)** completely before suggesting or changing
anything. It contains findings verified by real-world testing that contradict
most online documentation. Do not re-derive them.

Then run `bash test/run-all.sh` to confirm the current state.

---

## What it does

**Diagnoses** what will cost you quality:

- Variable frame rate — the most common reason a 60 fps export is delivered at 30
- Broken HDR colour tags — wide-gamut pixels labelled as SDR (the CapCut fault)
- Dolby Vision profile and RPU presence
- Transfer damage — a file already re-encoded by WhatsApp or iOS "Automatic" transfer
- QuickTime branding, edit lists, `moov` position

**Fixes the container losslessly.** Streams are copied byte-for-byte; only the
container layout changes, so the file size is identical:

| Operation | Effect |
|---|---|
| `moov` → front | faststart; chunk offsets rewritten |
| QuickTime → MP4 | `ftyp` major brand `qt  ` → `mp42` |
| Edit lists | `edts` renamed to `free` so readers skip it |
| Strip Dolby Vision | `dvcC` → `free` *(off by default — see HANDOFF)* |
| Frame-rate method | `mvhd`+`mdhd` timescale ÷2/÷4 — TikTok's encoder decimates nothing *(the ut0ku/Zilem-style patch — default on for 60/120 fps, works on HDR)* |
| Duration patch | `mvhd` duration → 1 tick, shows 00:00 *(opt-in · experimental on HDR — §2.3b confound; keep out of iOS Photos — can crash the gallery)* |

**Transcodes** (CLI only) — optional 4K → 1080p downscale (`--1080p`) while
preserving Dolby Vision, via `dovi_tool` extract → encode → inject → verify.
4K is kept by default now — TikTok accepts it.

**Verifies** — download your post back from TikTok and compare what you sent
against what they served.

**Experiments** — one-click A/B kit for HDR files: writes method-only,
plain-HDR and untouched variants (site) or `./vague.sh clip.mp4 --remux-only
--kit` (CLI). Post them all the same way and let the delivered files tell you
which recipe your account rewards.

---

## The honest part

**Every platform re-encodes every upload** — but the ceiling is higher than
the blogs say: measured on our account (Sept 2026), TikTok delivered a 4K60
upload back as **4K 60**. No tool prevents the re-encode; anything
claiming "no compression" is describing the file it hands back, not what
viewers receive. Verify your own delivery: post, download the post back, use
the compare tool.

What you can control is the quality of the source their encoder works from, and
whether your frame rate and colour survive the trip.

---

## Layout

```
core/         decision engine + diagnosis rules
extension/    MV3 browser extension — also the source of truth for the
              four shared engine modules
site/         the GitHub Pages website (engine copied into site/lib/)
cli/          Linux + Windows CLI, local desktop app, doctor, installers
test/         6 unit suites + 2 real-Chromium end-to-end suites + fixtures
docs/         setup guides, competitor teardown, experiment plans
_archive/     leftovers from a wrong early assumption — ignore
```

One engine, four surfaces. Change a shared module in `extension/` and copy it to
`site/lib/`, or they drift.

---

## Quick start

**Website** — nothing to install, works on phone and desktop:
https://willsonraiii.github.io/vague-transcode/

**Extension** — `chrome://extensions` → Developer mode → Load unpacked →
select `extension/`

**CLI**
```bash
cd cli
./setup.sh              # Linux    (or: powershell -File setup.ps1 on Windows)
./doctor.sh             # preflight
./vague.sh clip.mp4 --remux-only
```

`--remux-only` needs nothing installed — it uses the built-in MP4 parser.
The full transcode needs ffmpeg, `dovi_tool` and MP4Box.

---

## Tests

```bash
bash test/run-all.sh
```

```
engine  17 · probe  34 · remux  12 · duration patch  13 · frame-rate method  13
rebrand + edit lists  10 · strip Dolby Vision  11
website  56 · extension  24        (real Chromium)
```

Browser suites need:
```bash
npm i playwright-core && npx playwright install chromium
sudo apt install -y xvfb libnspr4 libnss3 libasound2t64 libatk1.0-0t64 \
  libatk-bridge2.0-0t64 libcups2t64 libgbm1 libxkbcommon0 libxcomposite1 \
  libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0
```

---

## Current best method

```
1. Shoot / export 4K60 or 1080p60 HDR — 4K60 delivery measured on our account
   (Sept 2026; HDR tags survived the download but in-app HDR playback is only
   expected on an UNPATCHED upload)
2. Transfer to PC losslessly  (iPhone: Settings → Photos → Keep Originals, then USB)
3. Fix the container  (website, extension, or ./vague.sh --remux-only --method)
4. Move back to the phone losslessly
5. Route it: TikTok Studio (desktop) as "Only me" → flip to Everyone in the
   app (community-verified: 60fps/HDR/HEVC survive), or the phone file route
   (Files picker / iOS share sheet). The gallery re-encodes — never the gallery
6. "Allow high-quality uploads" ON
7. Do not edit after posting — no sounds, trims, filters
8. Wait 30+ minutes, check on the phone (desktop web never shows HDR)
```

⚠️ A duration-patched file **cannot** be uploaded from TikTok Studio on desktop —
it will be refused. Phone app with Files/attach only. And the patch is **SDR-only**:
a patched HDR file stops *rendering* as HDR in TikTok's player (HANDOFF §2.3b),
so every surface refuses that combination now.

---

## Status

Personal project, not commercial. See `HANDOFF.md` §8 for open questions — the
main one being that **no delivered upload has been measured yet**, so several
conclusions remain theory.
