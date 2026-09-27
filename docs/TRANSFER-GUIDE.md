# Getting video from phone → desktop without losing anything

Your phone says **4K, HEVC, Dolby Vision, 60fps**. The file on your PC reads
**H.264, 8-bit, SDR, 30fps**. Both are true — they are not the same file.
Something re-encoded it in transit.

This is the single most common way creators lose quality, and it happens
*before* TikTok is involved at all. No transcoder can recover it afterwards.

> Small note: **Dolby Atmos** is the audio format. The video HDR format your
> iPhone records is **Dolby Vision** (profile 8.4). Both can survive — but only
> on a lossless transfer.

---

## ✅ Lossless — the file arrives byte-identical

| Method | Notes |
|---|---|
| **USB cable, direct file copy** | The gold standard. iPhone: set Keep Originals first (below). Android: MTP copy from DCIM. |
| **AirDrop** (iPhone → Mac) | Truly lossless, keeps Dolby Vision. |
| **Telegram → "Send as File"** | Must choose *File*, not *Video*. No re-encode, 2 GB limit (4 GB Premium). |
| **Google Drive / Dropbox / OneDrive — upload as a file** | Use the Drive/Dropbox app's *Upload file*, not photo backup. |
| **iCloud Photos → Download Originals** | Preserves HEVC/DV if "Download and Keep Originals" is set. |
| **SD card / external SSD** | Plain file copy. |

## ❌ Lossy — these re-encode, every time

| Method | What it does |
|---|---|
| **WhatsApp (as video)** | Brutal. Typically 720p H.264 30fps. Destroys HDR entirely. |
| **Messenger / Instagram DM / Snapchat** | Same — all re-encode aggressively. |
| **iOS "Automatic" PC transfer** | Converts HEVC → H.264 silently. **This is probably your culprit.** |
| **Google Photos "Storage saver"** | Re-encodes to save space. |
| **Email** | Size caps force compression. |
| **Telegram "Send as Video"** | Re-encodes. Use *Send as File* instead. |
| **Bluetooth** | Lossless but painfully slow at 4K. |

---

## 🔴 The iPhone setting that is most likely doing this

```
Settings → Photos → scroll to "Transfer to Mac or PC"
   ○ Automatic        ← converts HEVC to H.264, drops Dolby Vision
   ● Keep Originals   ← choose this
```

"Automatic" exists so old Windows machines can open the file. The cost is that
it re-encodes your 10-bit HEVC Dolby Vision into 8-bit H.264 SDR — and
frequently halves 60fps to 30fps at the same time.

**That triple downgrade is exactly what your probe showed.**

Also check:
```
Settings → Camera → Formats → High Efficiency   (not "Most Compatible")
Settings → Camera → Record Video → 4K at 60 fps
Settings → Camera → Record Video → HDR Video: ON
```

## 🟢 Android

```
USB → choose "File Transfer / MTP" (not "Charging only")
Copy from  Internal storage / DCIM / Camera
```
Samsung: Settings → Camera → Advanced → *Video codec: High efficiency (HEVC)*.
Avoid "Link to Windows" video sharing for masters — copy the file directly.

---

## How to confirm before you upload

1. Note the file **size in MB on the phone**.
2. Note the size on the desktop.
3. **If it shrank, it was re-encoded.** A lossless transfer is byte-identical.

Then scan it with Vague Guard. A genuine 4K60 HDR master reads:

```
video     2160x3840  hevc  10-bit
timing    60 fps  CFR
colr box  primaries=bt2020  transfer=arib-std-b67 (or smpte2084)
dolby     RPU=yes profile 8.4
verdict   HDR (dolbyvision)
```

If it instead reads `h264 / 8-bit / bt709 / SDR`, the transfer damaged it.
Vague Guard now flags this explicitly as **"transfer-damaged copy."**

---

## Why this matters more than anything else in the pipeline

Ordered by how much quality each step costs you:

1. **Lossy transfer phone → desktop** — catastrophic, and completely avoidable
2. Editor exporting with the wrong colour tags (the CapCut problem)
3. Uploading VFR instead of CFR — platform re-times, 60fps becomes 30fps
4. TikTok's own re-encode — unavoidable, but the gentlest of the four

You cannot do anything about #4. You can eliminate #1, #2 and #3 completely.
Most creators fight #4 and ignore the other three.

---

## The best possible TikTok path, end to end

```
Record 4K60 HDR (HEVC, Dolby Vision on)
        ↓  USB / AirDrop / Telegram-as-File   ← lossless
Desktop master, still HEVC 10-bit DV 60fps
        ↓  Vague Guard: scan → fix → substitute
1080x1920, 60fps CFR, correct colour tags, faststart, ~18 Mbps
        ↓  TikTok Studio on desktop (4 GB limit, single compression pass)
        ↓  "Allow high-quality uploads" ON in the app settings
Delivered: 1080p60, correct colour
```

Every arrow above is one you control, except the last.
