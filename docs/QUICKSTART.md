# Quickstart — the one path to follow

For: 4K60 Dolby Vision master → TikTok.
Everything else in this repo is an alternative or a fallback. Follow this.

---

## Step 0 · Get the file onto your PC without wrecking it

This matters more than anything downstream. A bad transfer already cost you
HEVC, Dolby Vision and half your frame rate once.

**iPhone**
```
Settings → Photos → Transfer to Mac or PC → KEEP ORIGINALS
```
Then USB cable, copy the file directly.

**Never** WhatsApp, Messenger, Instagram DM, or email.
Telegram is fine **only** via "Send as File".

**Check:** file size on phone == file size on PC. If it shrank, it re-encoded —
start over.

---

## Step 1 · Install (once, ~10 min)  —  Linux

**ffmpeg**
```bash
sudo apt install ffmpeg          # Debian / Ubuntu / Mint / Pop
sudo dnf install ffmpeg          # Fedora  (may need RPM Fusion)
sudo pacman -S ffmpeg            # Arch / Manjaro
```

> Distro ffmpeg sometimes ships an x265 without Dolby Vision support.
> Doctor (Step 2) tells you. If it fails, use a static build instead:
> ```bash
> wget https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
> tar xf ffmpeg-release-amd64-static.tar.xz
> sudo install ffmpeg-*-static/ffmpeg ffmpeg-*-static/ffprobe /usr/local/bin/
> ```

**dovi_tool** — needed for Dolby Vision
```bash
# grab the latest x86_64-unknown-linux-musl tarball from:
#   https://github.com/quietvoid/dovi_tool/releases
tar xf dovi_tool-*-x86_64-unknown-linux-musl.tar.gz
sudo install dovi_tool /usr/local/bin/
dovi_tool --version
```

**Node 18+**
```bash
node --version    # if missing: sudo apt install nodejs npm
```

---

## Step 2 · Run Doctor

```bash
cd cli
chmod +x *.sh        # first time only
./doctor.sh
```

Look at check 5:

```
5. Dolby Vision encode capability
  ✓ x265 accepted dolby-vision-profile=8.4   full DV pipeline should work
```

| Result | Do |
|---|---|
| ✓ on check 5 | Continue to Step 3 |
| ✗ on check 5 | Your x265 lacks DV support → use the static build above, or fall back to Path 2 |
| ✗ ffmpeg missing | PATH problem — open a new terminal, or reinstall |

Do not skip this. It is 30 seconds and it prevents a wasted encode.

---

## Step 3 · Start the app

```bash
./vague-app.sh
```

It opens `http://127.0.0.1:4777` in your browser. Paste the full path to your
master, press **Scan**.

Prefer the terminal? Same engine, no browser:
```bash
./vague.sh ~/Videos/master.mov --dry-run   # see the plan first
./vague.sh ~/Videos/master.mov             # actually run it
```

You should see:

```
★ Dolby Vision 8.4 · 60fps · ready

Output   1080×1920 @ 60fps        Target  19.1 Mbps · ~32 MB

✓ Resolution   2160×3840 → 1080×1920
✓ Frame rate   60 fps CFR — preserved exactly
✓ Codec        hevc 10-bit
✓ Colour       Dolby Vision 8.4
```

Leave all three checkboxes **unticked** for your first run.

Press **Optimize — keep Dolby Vision**.

---

## Step 4 · Read the verify block

This is the moment of truth:

```
Extracting Dolby Vision RPU
  ✓ RPU extracted (412 KB)
Encoding (Dolby Vision)      ████████░░  78%  · 1.4x
  ✓ Dolby Vision RPU verified in output
✓ Done — 31.8 MB
1080×1920 @ 60fps · hevc 10-bit · DOLBYVISION
```

If it says **"Dolby Vision was LOST"** the tool fails on purpose rather than
hand you a broken file. Tell me the error.

---

## Step 5 · Upload

1. **TikTok Studio, desktop web** (Firefox/Chrome on Linux is fine) — not the phone app
2. Confirm **"Allow high-quality uploads"** is ON (phone → Profile → Menu →
   Settings and privacy → Content preferences)
3. Post **public**, not "Only Me"
4. **Do not edit after uploading.** No sounds, trims, filters, text. Any edit
   makes TikTok re-process and undoes the work.

---

## Step 6 · Check it properly

- **Wait 30+ minutes.** HDR variants are generated after the first SDR one.
- **Check on your PHONE**, in the app, on the OLED screen.
- **Desktop web never shows HDR** — checking there tells you nothing.
- The tell: screen brightness jumps above the surrounding UI.

Objective version: download your own post and drop it into Vague. Read
`colorTransfer` in the raw probe. `arib-std-b67` or `smpte2084` = HDR survived.

---

## If Step 2 fails and you cannot fix ffmpeg

Fall back to **Path 2 — lossless remux**, which needs nothing installed:

1. Load the extension — Chrome/Chromium/Brave on Linux:
   `chrome://extensions` → Developer mode → Load unpacked → pick `extension/`
2. Go to TikTok Studio → Upload, select your file
3. Panel shows **⏸ Upload held**
4. Press **⚡ Optimize container & upload — lossless, keeps Dolby Vision**

That is genuinely lossless and already proven on your file (247 chunk offsets
rewritten, output size identical to input). It just uploads 4K and lets TikTok
do the downscale.

---

## What we know vs what we are testing

| | Status |
|---|---|
| Transfer damage is real | ✅ confirmed on your own file |
| Remux is lossless | ✅ proven — identical byte count |
| Probe reads your file correctly | ✅ TikTok's 4K badge agrees |
| DV survives our encode | ⏳ **Step 4 answers this** |
| 1080p beats letting TikTok downscale | ⏳ needs the A/B in EXPERIMENT.md |
| Duration patch does anything | ⏳ untested, leave it off for now |
