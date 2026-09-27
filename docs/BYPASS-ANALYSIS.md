# Competitor teardown — Zilem Method & RTXFury

Two tools your users already know about. Both claim to beat TikTok compression.
Here is what they actually do, what works, and where you can beat them.

---

## What they do

### Zilem Method (v1.5)
> *"It optimizes your MP4/MOV container so platforms don't degrade it before
> re-encoding — no video re-encode, no quality loss."*
> *"Streams are copied — we never touch the pixels or the audio samples."*

**This is a faststart remux.** Identical in principle to `extension/remux.js`.
Honest description, no overclaiming. MOV→MP4 rewrap included.

Scale: ~36.5k videos optimized, ~36.3k Discord members, tiered access, free
weekly "patches". Their own TikToks about it pull 24k–68k views.

### RTXFury (RTX Engine v2.0)
> *"It optimizes the MP4 container and **modifies key metadata** to help TikTok
> reduce the amount of compression applied."*

Goes beyond remuxing. The giveaway is in their own usage notes:

> ⚠️ *"Showing **'0 seconds'** in video after optimizing is normal. Ignore it.
> It plays smoothly once uploaded on TikTok."*

**They are zeroing the duration fields** in `mvhd` / `tkhd` / `mdhd`.

---

## Why zeroing duration plausibly works

Ingest pipelines classify an upload before transcoding it. A near-universal
input to that decision is:

```
input_bitrate = filesize / duration
```

With `duration = 0` that is a divide-by-zero or a nonsense value. Anything
downstream that branches on "is this a high-bitrate source that needs heavy
compression?" gets garbage, and the observed behaviour is that TikTok falls
back to a lighter-touch path.

Supporting evidence, all from RTXFury's own rules:

| Their rule | What it implies |
|---|---|
| "Do not edit after optimizing (sounds, trims, filters)" | TikTok's editor re-muxes and repairs the metadata, undoing it |
| "Visibility must be Everyone, not Only Me" | Private posts take a different processing path |
| "iOS: upload from Files app, not gallery" | Gallery upload re-encodes — the transfer damage we already documented |
| "Enable Upload HD, post via TikTok web" | Stacking the legitimate levers on top |

Note the shape of this: a list of fragile conditions. That is what exploiting a
bug looks like, not what using a feature looks like.

---

## What is real vs what is marketing

| Claim | Verdict |
|---|---|
| "No re-encode, streams copied" | ✅ **True.** This is a remux. |
| "Zero quality loss" (in the file) | ✅ **True** of the file itself. |
| "Zero quality loss" (after TikTok) | ❌ TikTok still re-encodes. Lighter, not absent. |
| "4K 120fps on TikTok" | ⚠️ 120fps is **stored**, not **delivered**. Playback is capped. |
| "TikTok applies no compression" | ❌ Overclaim. |
| Duration-zero bypass | ✅ Real, and evidently effective at scale |

The "4K 120fps" headline is the same trap I warned you about — it describes the
uploaded file, not what viewers receive. It sells, but it is not true at the
delivery end.

---

## Risks you must weigh before shipping this

1. **It is a bug, not an API.** One ingest change and it stops working —
   probably without notice. A paid tier built on it can break overnight.
2. **Malformed files can be rejected.** Some validators refuse zero-duration
   media outright. Expect a failure rate.
3. **Player weirdness.** Scrub bars and previews show 0:00. Competitors ship a
   permanent "this is normal" disclaimer — you would too.
4. **Detection.** Zero duration is trivially detectable server-side; so is a
   population of accounts posting it. Unknown whether TikTok cares today.
5. **You cannot promise it.** If you charge for it, you are charging for
   something a third party can disable at will. Price and word it accordingly.

---

## Where you can beat both of them

Neither tool does any of the following:

| Gap | Your advantage |
|---|---|
| **No HDR / Dolby Vision handling** | Your probe reads the DV RPU; `nova-server` preserves it through a real re-encode |
| **No diagnosis** | You detect the CapCut mis-tag and the phone→PC transfer damage. They just process blindly. |
| **No VFR fix** | The single biggest cause of "my 60fps became 30fps" — neither addresses it |
| **Both are upload-a-file websites** | You have a browser extension that intercepts at the point of upload |
| **Discord-gated** | Real friction. A one-click extension beats "join our server" |
| **No verification** | Neither re-probes the *delivered* video. You can. |

Their FAQ even admits they cannot fix a bad source. Yours can *explain* one.

---

## Recommended positioning

Offer the container patch **and** be the only tool that tells the truth:

```
✓ Lossless container optimization        (matches Zilem/RTXFury)
✓ + Duration patch (experimental)        (matches RTXFury)
✓ + HDR / Dolby Vision preserved         ← nobody else
✓ + Diagnoses WHY your video looks bad   ← nobody else
✓ + Verifies what TikTok actually served ← nobody else
✓ + Works inside the upload page         ← nobody else
```

Label the duration patch **experimental**, explain it may stop working, and do
not build a paid tier on it alone. Sell the diagnosis and the HDR pipeline —
those cannot be patched away by TikTok.

---

## Business model notes

Both use the same playbook, and it works in this niche:

- **Discord-gated tiers** — free tier requires joining the server; Nitro boost
  upgrades you; Premium is a DM to the owner
- **Usage caps** — 3/day free, 5/day boosted, unlimited premium
- **Live counters** on the site (videos optimized, members online) as social proof
- **Their own TikToks are the funnel** — "4K 120fps method" tutorials at 25k–68k views

Your WhatsApp-channel + coin model is the same shape, adapted for an Indonesian
audience. That is a reasonable fit. The differentiator has to be the product.
