# Nova — Rewritten Copy (legally safe, technically accurate, still premium)

## Why the current copy has to change

| Current text | Problem | Severity |
|---|---|---|
| "Dolby Vision support" | Trademark use in commercial advertising requires a signed Dolby Logo Use Agreement; software vendors implementing DV need a license. | 🔴 Legal |
| "HDR10+ support" | No social platform ingests HDR10+ dynamic metadata. Customer pays 3 coins, metadata is discarded at upload. | 🔴 Refund/trust |
| "improved video and audio quality" | Implies Nova makes the video *better* than the source. It cannot. | 🟡 Trust |
| "4K 120fps" (page headline) | Neither survives any platform. Undermines every other claim on a paid page. | 🟡 Trust |

**Rule for all paid copy: describe the technical capability, never the brand,
and never promise a result that happens on someone else's server.**

---

## Replacement copy

### Method card — Indonesian (primary)

> **Vague Nova** · PREMIUM · 3 koin / encode
>
> Encoding di server GPU: lebih cepat untuk file besar, dan satu-satunya metode
> yang mempertahankan **HDR 10-bit** (PQ / HLG, profil 8.4-compatible) tanpa
> diturunkan ke SDR.
>
> Frame rate sumber dipertahankan persis — 60fps tetap 60fps.

### Method card — English

> **Vague Nova** · PREMIUM · 3 coins / encode
>
> GPU server encoding: faster on large files, and the only method that keeps
> **10-bit HDR** (PQ / HLG, profile 8.4-compatible) instead of flattening it to SDR.
>
> Source frame rate preserved exactly — 60fps stays 60fps.

**What changed and why**
- "Dolby Vision" → "profil 8.4-compatible" / "profile 8.4-compatible".
  Describes the actual bitstream format. No trademark, no license needed.
- "HDR10+" → dropped entirely. Replaced with "HDR 10-bit (PQ / HLG)", which is
  what genuinely survives.
- "improved video and audio quality" → removed. Replaced with the one quality
  claim you can actually prove: frame-rate preservation.

---

## Required pre-purchase disclosure

Show this **before** coins are spent, not after. Trigger it from the engine's
`warnings[]` array — the logic already exists in `core/profiles.js`.

### When source is HDR10+
> ⚠️ **HDR10+ metadata tidak bisa dipakai di platform sosial manapun.**
> Kami akan mengkonversi lapisan dasar HDR10 ke format 10-bit profil 8.4 —
> gamut lebar dan 10-bit tetap terjaga, metadata per-scene HDR10+ hilang.
> Ini batasan platform tujuan, bukan batasan Nova.

### When target is anything except Instagram iOS
> ⚠️ **Tujuan ini tidak menerima HDR.** Video akan di-tonemap ke SDR dengan
> kurva BT.2390 (hasil jauh lebih baik daripada tonemap otomatis platform).
> Kalau kamu ingin mempertahankan HDR, upload lewat aplikasi Instagram di iOS.
> **Nova tidak diperlukan untuk hasil SDR — Forge sudah cukup dan gratis.**

That last sentence costs you a sale and buys you a customer. Telling someone not
to spend money is the single most effective trust signal a paid tool has.

---

## Headline fix

| | |
|---|---|
| Now | "Pilih metode yang ingin kamu gunakan. **4K 120fps.**" |
| Replace with | "Pilih metode yang ingin kamu gunakan. **60fps masuk, 60fps keluar.**" |
| EN | "Choose the method you want to use. **60fps in, 60fps out.**" |

Provable, unique, and currently broken in every competing tool.

---

## Beta + payment disclosures (required on a paid page)

Nova is badged **BETA BACKEND** while charging money. You need, visibly:

1. **Refund rule:** "Koin dikembalikan otomatis kalau encode gagal atau timeout."
   Enforce it server-side, not manually.
2. **Coin expiry:** state it explicitly, or state that coins never expire. Silence
   here is what triggers chargebacks.
3. **Beta scope:** "Backend Nova masih beta — mungkin ada antrean atau downtime.
   Koin tidak hangus saat downtime."
4. **Where coins live:** "Koin terikat pada Nova key kamu, bukan pada browser."
   (Requires the wallet fix — see `wallet-spec.md`.)

---

## Footer attribution (only if you later license Dolby)

Do **not** add this yet. It is only valid once a Dolby agreement is signed:

> Manufactured under license from Dolby Laboratories. Dolby, Dolby Vision, and
> the double-D symbol are trademarks of Dolby Laboratories.

Using this line *without* the agreement is worse than saying nothing — it is an
affirmative false statement of license.
