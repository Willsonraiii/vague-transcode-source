# Prompt guide — starting a new agent on this project

Copy the block below into a fresh agent. That is all it needs.

---

## ▶ The prompt

```
I'm continuing an existing project. The repo is at
https://github.com/Willsonraiii/vague-transcode

Before suggesting or changing ANYTHING:
  1. Read README.md
  2. Read HANDOFF.md in full — all 10 sections
  3. Run: bash test/run-all.sh
  4. git fetch origin — the owner changes machines constantly; GitHub is the
     only source of truth. Never assume any local checkout is current.

HANDOFF.md contains findings verified by real-world testing that contradict
most online documentation and blog posts. Do not re-derive them from first
principles, and do not "correct" them from your training data.

Key context:
- Personal project, not commercial. Ignore _archive/ entirely.
- One engine, four surfaces (core + extension + site + cli). They must stay in
  sync — a shared module changed in extension/ must be copied to site/lib/.
- Section 5 lists bugs already fixed. Don't reintroduce them.
- Section 6 lists what the previous assistant got wrong. When my real-world
  observations conflict with your reasoning, believe the observations.
- Section 8 lists open threads. Section 10 is a log of dead ends.
- I'm on Linux Mint (2-core Celeron laptop) and Windows.
```

---

## Why it needs to be worded that way

**"Do not re-derive them"** — the biggest risk is a fresh model confidently
restating things from training data that this project already disproved by
testing. For example:

| Model will likely say | Reality here |
|---|---|
| "TikTok doesn't support HDR" | It does — app only |
| "TikTok caps uploads at 1080p/60" | It accepts 4K and 120 fps (owner-verified Sept 2026). Delivery above 1080p is unmeasured — acceptance ≠ delivery |
| "There's no way around platform compression" | The duration patch is real and is what paid tools sell |
| "Keep Dolby Vision, more metadata is better" | Unresolved — it may be breaking HDR. See §8 |
| "Use ffmpeg.wasm to transcode in the browser" | Canvas is SDR-only; it destroys HDR |
| "Set up a cloud transcode service" | Not needed and not wanted |

**"Believe the observations"** — the owner found five separate things the
previous assistant had wrong, every time by checking real output. That pattern
held without exception.

**"Run the tests"** — grounds the agent in the actual state instead of guessing
from filenames.

---

## Files an agent should read, in order

| File | Why |
|---|---|
| `README.md` | what the project is, layout, quick start |
| `HANDOFF.md` | **the important one** — verified findings, bugs, dead ends, open threads |
| `docs/TRANSFER-GUIDE.md` | phone→PC without destroying the file |
| `docs/BYPASS-ANALYSIS.md` | competitor teardown, where the duration patch came from |
| `docs/EXPERIMENT.md` | the A/B test plan that still hasn't been run |

Ignore `_archive/` — leftovers from an early wrong assumption that this was a
commercial product on someone else's website.

---

## Where to pick up

The single highest-value action, still undone:

**Post one clip through the full method, download it back, and drop it into the
"Did it survive?" tool on the site.** Everything else is theory until there is
one measured result.

The live open question (HANDOFF §8): **does stripping Dolby Vision break HDR
on TikTok?** It was briefly on by default and HDR stopped surviving. It is now
off by default. Two uploads — one with, one without — would settle it.

---

## Working agreements

- Show the command to run rather than explaining at length
- Keep all four surfaces at feature parity; the website and extension must not
  lag the CLI
- Test in a real browser before claiming the website or extension works —
  `test/e2e-site.mjs` and `test/e2e-extension.mjs` exist for this
- Never claim "no quality loss" about anything the platform re-encodes
- **The owner changes machines constantly.** Never hand work over as local
  files, folder paths, or patch files to apply later — commit and push to
  GitHub before ending a session. The repo is the only thing that follows
  them between machines; everything local (including the Windows checkout at
  `C:\Users\Admin\Projects\original`) may be stale or absent. If `site/`
  changed, deploy with `./deploy-site.sh` (repo root) — the live tool is
  served from the separate Pages repo `Willsonraiii/vague-transcode`.
