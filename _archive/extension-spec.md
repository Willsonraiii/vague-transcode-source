# Vague Guard — Desktop Browser Extension

**The pitch, stated honestly and ambitiously:**
> Most creators lose their quality *twice* — once when their phone re-encodes
> before upload, and again in TikTok's pipeline. Vague Guard removes the first
> loss entirely and makes the second one as gentle as it can possibly be.

That is a large, real, provable claim. It does not require pretending TikTok
doesn't re-encode.

---

## Why the extension is the strongest surface

| Upload path | Compression passes | Result |
|---|---|---|
| Phone → TikTok app | **2** (phone re-encodes, then TikTok) | worst |
| Phone → desktop transfer → tiktok.com | 1 | better |
| **Editor export → Vague Guard → TikTok Studio** | **1, from an optimally conditioned source** | **best possible** |

Eliminating a whole generation of lossy encoding is the single biggest win
available to anyone. No web tool, no phone app, and no competitor is doing this
at the point of upload.

Additionally, desktop web upload allows **4 GB** vs 287.6 MB on mobile — so you
can hand TikTok a much richer source to re-encode from.

---

## What it does, in order

### 1. Scan (before anything else)
Content script watches `tiktok.com/tiktokstudio/upload` and
`tiktok.com/upload` for the file input. On file selection, probe **locally**
via `mp4box.js` / WebCodecs:

- resolution, rotation, display matrix
- **frame rate + VFR detection** (the killer feature)
- codec, profile, level, bit depth
- colour: primaries / transfer / matrix, HDR format, DV RPU presence
- bitrate, duration, audio codec/rate
- moov atom position (faststart or not)

### 2. Verdict panel — injected next to the uploader
```
┌─ VAGUE GUARD ─────────────────────────────┐
│ ✓ 1080×1920          matches TikTok bucket│
│ ⚠ 59.94 fps VFR      → will be re-timed   │
│ ✗ HEVC               → TikTok re-encodes  │
│                         H.265 lossily     │
│ ✗ PQ / BT.2020       → will be clipped,   │
│                         not tonemapped    │
│ ⚠ moov at end        → slower ingest      │
│ ✓ 184 Mbps           plenty to work from  │
│                                            │
│   3 issues will cost you quality.          │
│   [ Fix all — 8s, on your machine ]        │
└────────────────────────────────────────────┘
```

### 3. Fix — locally, then substitute the file
Run the plan from `core/profiles.js` through ffmpeg.wasm / WebCodecs, then swap
the `File` object into the input before submit:

```js
const dt = new DataTransfer();
dt.items.add(new File([fixedBlob], name, { type: 'video/mp4' }));
input.files = dt.files;
input.dispatchEvent(new Event('change', { bubbles: true }));
```

React-controlled inputs need the native setter:
```js
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')
  .set.call(input, dt.files);
```

### 4. The account-setting nag — highest value per line of code
TikTok's **"Allow high-quality uploads"** (Profile → Settings and privacy →
Content preferences) applies to *all* uploads including desktop, and most
creators have never found it. Without it, **TikTok defaults to 30fps playback
even for 60fps sources.**

> ⚠ "Allow high-quality uploads" appears to be OFF on this account.
> Your 60fps will be delivered at 30fps. [Show me how to enable it →]

You cannot read their settings cross-origin, so: detect the setting page, or
prompt once per account on first use and remember the acknowledgement. This
costs almost nothing and is the single biggest quality lever a creator controls.

### 5. Verify — the part that markets itself
After the post goes live, fetch the delivered variant and re-probe:

```
                SOURCE        YOUR UPLOAD     TIKTOK DELIVERED
Resolution      3840×2160  →  1080×1920    →  1080×1920   ✓
Frame rate      59.94 VFR  →  59.94 CFR    →  59.94       ✓  ← the win
Colour          PQ/BT.2020 →  BT.709 SDR   →  BT.709      ✓
Bitrate         184 Mbps   →  18 Mbps      →  2.4 Mbps
```

Nobody in this niche shows the third column. It turns an invisible claim into a
screenshot creators post themselves.

---

## Per-platform targets (already implemented in `core/profiles.js`)

| | TikTok | IG Reels (iOS) | IG Reels (web) | YT Shorts |
|---|---|---|---|---|
| Codec | **H.264 High** | HEVC Main10 | H.264 High | H.264 High |
| Why | TikTok re-encodes H.265 lossily | DV 8.4 path | no HDR via web | — |
| Res | 1080×1920 | 1080×1920 | 1080×1920 | 1080×1920 |
| FPS | source, ≤60 | source, ≤60 | source, ≤60 | source, ≤60 |
| HDR | tonemap BT.2390 | **preserve** | tonemap | preserve |
| Bitrate | 10–20 Mbps | 10–22 Mbps | 10–20 Mbps | 12–30 Mbps |

**Note the inversion:** H.265 is *worse* for TikTok and *required* for Instagram
HDR. A single universal preset cannot be right for both — which is precisely why
the per-platform engine is the product.

---

## Manifest (MV3)

```json
{
  "manifest_version": 3,
  "name": "Vague Guard — HD upload for TikTok & Instagram",
  "version": "1.0.0",
  "permissions": ["storage", "scripting"],
  "host_permissions": [
    "https://www.tiktok.com/*",
    "https://www.instagram.com/*"
  ],
  "content_scripts": [{
    "matches": [
      "https://www.tiktok.com/tiktokstudio/upload*",
      "https://www.tiktok.com/upload*",
      "https://www.instagram.com/create/*"
    ],
    "js": ["content.js"],
    "run_at": "document_idle"
  }],
  "web_accessible_resources": [{
    "resources": ["ffmpeg-core.wasm", "ffmpeg-core.js", "panel.html"],
    "matches": ["https://www.tiktok.com/*", "https://www.instagram.com/*"]
  }]
}
```

**Store-review notes:**
- Request only the two host permissions. Broad `<all_urls>` triggers manual review.
- Everything runs locally — say so in the listing; it's both true and a selling point.
- ffmpeg.wasm needs `SharedArrayBuffer` → COOP/COEP. In a content script you
  cannot set the host page's headers, so run the encode in an **offscreen
  document** or the extension's own page, not in the TikTok tab.

---

## Honest marketing copy

**Headline**
> Upload once. Lose nothing you didn't have to.

**Subhead**
> Your phone compresses your video before TikTok even sees it. Vague Guard
> removes that step, hands TikTok the cleanest possible source, and keeps your
> frame rate exactly where you exported it.

**Three claims — all provable**
1. **One compression pass instead of two.** Phone uploads re-encode before
   sending. Desktop + Vague Guard doesn't.
2. **Your frame rate survives.** 60fps in, 60fps out — verified after upload.
3. **HDR handled properly.** Preserved where the platform carries it, tonemapped
   with a real curve where it can't — never clipped to grey.

**What to never claim**
- ✗ "No quality loss" / "TikTok won't compress"
- ✗ "4K on TikTok" (1080p delivery ceiling)
- ✗ "120fps" (60 ceiling)
- ✗ "HDR10+ on TikTok" (no HDR pipeline at all)
- ✗ "Dolby Vision" as a marketing term without a Dolby licence

The gap between "no loss" and "one pass instead of two, at maximum quality" is
the gap between a claim that collapses under a screenshot and one that wins you
the most demanding customers in the niche.
