# The experiment — run this before building anything else

**Goal:** find out which of the four techniques actually changes what TikTok
delivers. Everything in the roadmap depends on this answer.

Budget: 4 posts, about an hour, plus 30 min processing wait.

---

## Setup

- **One source clip.** Same footage for all four. 15–30s. Ideally your 4K60
  Dolby Vision master, transferred over USB with **Keep Originals**.
- **"Allow high-quality uploads" ON** (you confirmed this).
- **Upload from TikTok Studio on desktop web** every time.
- Post **public** ("Everyone"). Private posts take a different path.
- **Do not edit after upload** — no sounds, trims, filters, text. Any edit makes
  TikTok re-mux and repair everything.
- Post them a few minutes apart, same time of day.

---

## The four variants

| # | Variant | How |
|---|---|---|
| **A** | **Control** — raw master | Extension panel → *Upload original unchanged* |
| **B** | **Lossless remux** | → *Optimize container* (patch checkbox OFF) |
| **C** | **Remux + duration patch** | → *Optimize container* (patch checkbox **ON**) |
| **D** | **1080p60 downscale** | Export 1080×1920 60fps ~18 Mbps from your editor, upload as-is |

D is the one that tests the "4K trap" — whether a clean Lanczos downscale beats
TikTok's own downscaler.

---

## Measuring (this is the part that matters)

**Wait 30+ minutes** after each post. HDR and higher rungs are generated after
the initial SDR variant.

Then for each of A–D:

1. Open the post **on your phone, in the TikTok app**, on the OLED screen.
   - Does the screen brightness jump? → HDR survived.
   - Does motion look smooth (60) or steppy (30)?
2. **Download the posted video** (save via the app, or a downloader).
3. **Drop that download into Vague Guard** and read the Raw probe.

Record this table:

| | A raw | B remux | C patched | D 1080p |
|---|---|---|---|---|
| Delivered resolution | | | | |
| Delivered fps | | | | |
| Delivered codec | | | | |
| `colorTransfer` | | | | |
| HDR on phone? (Y/N) | | | | |
| Delivered bitrate | | | | |
| Sharpness (1–5, by eye) | | | | |

---

## How to read the result

| Outcome | What it means | What to do |
|---|---|---|
| C clearly beats A and B | The duration patch works in your region | Ship it as experimental; still don't build the paid tier on it alone |
| B = C | The patch does nothing | Drop it. Sell the honest remux + diagnosis |
| A = B = C | Container work has no effect here | Pivot hard to diagnosis + HDR + the transfer guide |
| D beats A | The "4K trap" is real | Nova's job becomes downscale-with-HDR — the thing no browser can do |
| HDR survives anywhere | Your biggest differentiator is confirmed | Build Nova's DV path next |
| HDR dies everywhere | TikTok HDR may need app-side upload | Re-scope before spending on Nova |

---

## Why this order

Building Nova costs weeks and real money. Its entire justification is
"downscale to 1080p while keeping Dolby Vision — impossible in a browser."

That justification is only true **if D beats A** and **if HDR survives at all**.
Two hours of testing decides whether a multi-week build is worth starting.

Do not skip this.
