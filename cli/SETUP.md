# Vague CLI — Windows setup (one time, ~10 minutes)

## 1. Node.js
https://nodejs.org → LTS installer → next-next-finish.
Check: open Command Prompt, type `node --version`.

## 2. ffmpeg (required)

Easiest, if you have winget:
```
winget install Gyan.FFmpeg
```

Manual:
1. https://www.gyan.dev/ffmpeg/builds/ → download **ffmpeg-release-full.7z**
2. Extract to `C:\ffmpeg`
3. Add `C:\ffmpeg\bin` to PATH:
   Start → "environment variables" → Environment Variables →
   Path → Edit → New → `C:\ffmpeg\bin` → OK
4. **Open a NEW Command Prompt**, type `ffmpeg -version`

> Get a **full** build. The "essentials" build often lacks libx265 with Dolby
> Vision support, which is the whole point.

## 3. dovi_tool (needed for Dolby Vision)

1. https://github.com/quietvoid/dovi_tool/releases
2. Download `dovi_tool-x.x.x-x86_64-pc-windows-msvc.zip`
3. Extract `dovi_tool.exe` into `C:\ffmpeg\bin` (already on PATH)
4. Check: `dovi_tool --version`

Without it you still keep HLG HDR — you just lose the Dolby Vision layer.

---

# Using it

**Drag and drop** — three launchers:

| File | What it does |
|---|---|
| `vague.bat` | Full optimise: 1080p60, HDR preserved, CFR locked |
| `remux-only.bat` | Lossless container fix — no re-encode at all |
| `vague-patched.bat` | Full optimise **+ duration patch** (experimental) |

Drag a video onto one. Output lands next to the original as `name-vague.mp4`.

**Command line**, for more control:

```bat
node vague.js "C:\clips\master.mov"
node vague.js "master.mov" --keep-4k            :: don't downscale
node vague.js "master.mov" --sdr                :: force SDR
node vague.js "master.mov" --patch              :: duration patch
node vague.js "master.mov" --remux-only         :: lossless only
node vague.js "master.mov" --platform ig_reels
node vague.js "master.mov" --dry-run            :: show commands, run nothing
```

Start with `--dry-run` to see exactly what it will do.

---

# What it does that a browser cannot

| | Extension | CLI |
|---|---|---|
| Probe / diagnose | ✅ | ✅ |
| Lossless remux | ✅ | ✅ |
| Duration patch | ✅ | ✅ |
| **Downscale 4K → 1080p keeping HDR** | ❌ | ✅ |
| **Dolby Vision RPU carry** | ❌ | ✅ |
| **Verify DV survived** | ❌ | ✅ |
| Speed | realtime | ~2–5× realtime |

A browser canvas is SDR-only, so any in-browser re-encode flattens HDR. The CLI
uses x265 directly and never touches a canvas.

---

# Workflow

```
Phone: record 4K60 HDR (Dolby Vision ON)
   ↓  USB, "Keep Originals"        ← never WhatsApp
Master on PC: HEVC 10-bit DV 60fps
   ↓  drag onto vague.bat
1080x1920 60fps CFR, DV 8.4 preserved, ~19 Mbps, faststart
   ↓  TikTok Studio, desktop web
   ↓  "Allow high-quality uploads" ON, post public, do not edit after
Posted
```

Then check on your **phone** (not desktop — web never shows HDR), 30+ min after
posting.
