# Vague Nova — Cloud GPU Transcode Pipeline

**Target (your words):**
> Video transcoding runs on a cloud server with fast GPU processing for quicker
> results, improved video and audio quality, and HDR10+ / Dolby Vision support.

This document is how to actually build that. One trap first, because it decides
your whole architecture.

---

## ⚠️ The trap: NVENC cannot carry Dolby Vision

This is the thing that breaks most first attempts.

**GPU encoders (NVENC/QSV/AMF) cannot write Dolby Vision RPU metadata.** They
encode pixels fast, but the dynamic per-frame metadata that *is* Dolby Vision is
dropped on the floor. If you pipe a DV file through `hevc_nvenc`, you get an
HDR-ish file with the Dolby Vision stripped — the exact failure your users are
already complaining about.

So "GPU processing" and "Dolby Vision support" pull in opposite directions.
The resolution is to **split the pipeline by job type**:

| Job type | Encoder | Why |
|---|---|---|
| SDR (most jobs) | **NVENC** | 10–20× realtime, quality is fine at 15–20 Mbps |
| HLG / HDR10 | **NVENC + static metadata** | NVENC *can* pass HDR10 mastering metadata |
| **Dolby Vision** | **libx265 + dovi_tool** | Only path that preserves the RPU |
| **HDR10+** | **libx265 + hdr10plus_tool** | Same — dynamic metadata needs CPU path |

Dolby Vision jobs cost ~8–15× more CPU time than an NVENC job. **Price them
differently** — this is why a flat "3 coins" will lose you money on exactly the
jobs you're advertising.

---

## Architecture

```
  Browser ──POST /api/nova/encode──▶ API (Next.js)
                                      │ hold coins (FOR UPDATE)
                                      │ presigned PUT
                                      ▼
  Browser ──direct upload──────────▶ S3/R2  (never through your API)
                                      │
                                      ▼
                                  Redis queue
                                   ╱        ╲
                        ┌─────────╱          ╲──────────┐
                        ▼                                ▼
                 GPU worker                       CPU worker
                 (NVENC, SDR/HLG)                 (x265 + dovi_tool, DV/HDR10+)
                        ╲                                ╱
                         ╲────────▶ S3 output ◀─────────╱
                                      │
                                      ▼
                              settle coins, notify
```

**Rule: video bytes never pass through your API server.** Presigned S3/R2 URLs
for both upload and download. Your API only moves JSON. This is the difference
between a $20/mo API box and a $300/mo one.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Object storage | **Cloudflare R2** | Zero egress fees. With video egress that is the whole ballgame vs S3. |
| Queue | **Redis + BullMQ** | Simple, has retries/backoff/priorities built in. |
| GPU worker | **RunPod / Vast.ai**, RTX 4000-class | $0.20–0.40/hr. Reserved is cheaper if you have steady load. |
| CPU worker | Hetzner CCX33 (8 vCPU) | ~€50/mo, dedicated. DV jobs live here. |
| DB | Postgres (Neon/Supabase) | Coin ledger — see `wallet-spec.md`. |
| API | Next.js on your existing host | Already deployed. |

Start with **one CPU box only**. Add GPU when queue depth justifies it — do not
pay for an idle GPU while you have ten users.

---

## The Dolby Vision pipeline (the valuable part)

Three stages, because the RPU must be carried around the encoder:

```bash
# 1. EXTRACT the Dolby Vision RPU from the source
ffmpeg -i input.mov -c:v copy -bsf:v hevc_mp4toannexb -f hevc - \
  | dovi_tool extract-rpu - -o rpu.bin

# 2. ENCODE the base layer with x265, telling it the RPU is coming
ffmpeg -i input.mov \
  -vf "scale=1080:1920:flags=lanczos,format=yuv420p10le" \
  -r 60 -fps_mode cfr \
  -c:v libx265 -preset medium -crf 18 \
  -x265-params "hdr-opt=1:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:dolby-vision-rpu=rpu.bin:dolby-vision-profile=8.4:vbv-bufsize=60000:vbv-maxrate=30000" \
  -c:a aac -b:a 192k -ar 48000 \
  -tag:v hvc1 -movflags +faststart out.mp4

# 3. VERIFY the RPU actually survived — never skip this
dovi_tool info -i out.mp4 -f 0
```

**Step 3 matters.** A DV job that silently loses its RPU produces a file that
looks fine to you and wrong to the user. Make verification a hard gate: if
`dovi_tool info` does not report profile 8.4, mark the job failed and
**auto-refund the coins**. Never deliver an unverified DV file.

### HDR10+ (be precise with users)
```bash
hdr10plus_tool extract -i input.mp4 -o hdr10plus.json
# encode with:  --dhdr10-info hdr10plus.json
```
HDR10+ *can* be preserved through your pipeline. But **no social platform
ingests HDR10+ dynamic metadata** — TikTok and Instagram both take Dolby Vision
/ HLG / HDR10. So market it as "HDR10+ input supported (converted to DV 8.4 or
HLG for upload)", never as "HDR10+ on TikTok".

---

## The NVENC path (most jobs)

```bash
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i input.mp4 \
  -vf "scale_cuda=1080:1920:interp_algo=lanczos" \
  -r 60 -fps_mode cfr \
  -c:v h264_nvenc -preset p6 -tune hq -rc vbr \
  -cq 19 -b:v 16M -maxrate 24M -bufsize 48M \
  -profile:v high -level 4.2 -bf 3 -rc-lookahead 32 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart out.mp4
```

`-preset p6` + `-tune hq` is the quality sweet spot. p7 is slower for marginal
gain; p1–p4 are visibly worse and not worth it on a paid tier.

**Honest note:** NVENC at 16 Mbps is roughly equivalent to x264 `slow` at
12 Mbps. Since you re-encode to well above TikTok's delivery bitrate anyway,
this difference is invisible in the final result. GPU is the right call for SDR.

---

## Cost model — read this before pricing

Per 60-second 1080p60 job:

| Path | Time | Machine cost | Cost/job |
|---|---|---|---|
| NVENC SDR | ~8 s | $0.30/hr | **$0.0007** |
| x265 medium HDR | ~90 s | $0.10/hr (CPU) | **$0.0025** |
| **x265 + DV RPU** | ~150 s | $0.10/hr | **$0.004** |
| R2 storage+egress | — | ~$0 egress | ~$0.0002 |

Even DV jobs cost under half a cent. **Your real costs are the idle GPU and
support time, not the encoding.** Two consequences:

1. **Do not keep a GPU running idle.** Use serverless GPU (RunPod Serverless)
   or spin up on queue depth. An idle RTX at $0.30/hr is $216/month to serve
   nothing.
2. **Charge more for DV than SDR.** 3 coins flat means DV jobs subsidise
   nothing and SDR jobs overcharge. Suggested: SDR 1 coin, HDR 2, DV 3.

---

## Retention — you already promise this

Your site says files are "dihapus sesuai siklus retensi". Enforce it in code:

```
R2 lifecycle rule: delete objects older than 24h
Worker: delete source immediately after successful output write
Cron: purge orphaned uploads with no job row after 2h
```

Put the actual number on `/data-retention`. "24 hours" is a promise you can
keep and verify; a vague "retention cycle" invites questions you cannot answer.

---

## Build order

1. **CPU worker only**, BullMQ + Redis, SDR path with libx264. Prove the queue,
   the hold/settle, and the refund-on-failure loop end to end.
2. **Add the DV path** with dovi_tool + the verification gate. This is your
   actual differentiator — nothing else in this niche does verified DV.
3. **Add NVENC** on serverless GPU once queue depth is consistently > 3.
4. **Add the verify-after-upload probe** (re-download the delivered file and
   compare). That is your marketing engine.

Do not start at step 3. A GPU is the most expensive way to discover your queue
logic has a bug.
