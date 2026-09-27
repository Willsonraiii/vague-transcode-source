# Nova Wallet — Key-Bound Balance Spec

## The problem with what's live now

> "The session uses an HttpOnly cookie for up to 14 days and ends when the key is revoked."

If the balance is keyed to the **session**, then clearing cookies, switching
browsers, or moving phone → desktop loses the coins. Users paid via WhatsApp,
so every loss becomes a manual support conversation with no audit trail.

**Fix: the key IS the account.** The cookie is only a convenience cache.

```
WRONG   session_cookie ──owns──> balance
RIGHT   nova_key ──owns──> balance
        session_cookie ──references──> nova_key   (disposable, rebuildable)
```

Re-entering the key on any device restores the wallet. Cheap now, painful later.

---

## Data model

```sql
CREATE TABLE nova_key (
  id            BIGSERIAL PRIMARY KEY,
  key_hash      BYTEA NOT NULL UNIQUE,   -- SHA-256 of normalised key. NEVER store plaintext.
  key_last4     TEXT  NOT NULL,          -- for support: "the key ending 8F2A"
  balance       INT   NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status        TEXT  NOT NULL DEFAULT 'active',  -- active | revoked | suspended
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  wa_contact    TEXT,                    -- hashed/partial; for dispute resolution
  note          TEXT
);

-- Every coin movement. The balance column is a cache of this ledger.
CREATE TABLE coin_ledger (
  id            BIGSERIAL PRIMARY KEY,
  key_id        BIGINT NOT NULL REFERENCES nova_key(id),
  delta         INT    NOT NULL,         -- +N topup, -N spend, +N refund
  reason        TEXT   NOT NULL,         -- topup | encode_hold | encode_refund | admin_adjust
  job_id        UUID,
  idempotency   TEXT UNIQUE,             -- prevents double-spend on retry
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE encode_job (
  id            UUID PRIMARY KEY,
  key_id        BIGINT NOT NULL REFERENCES nova_key(id),
  cost          INT    NOT NULL,
  state         TEXT   NOT NULL,         -- held | running | delivered | failed | expired
  plan_json     JSONB  NOT NULL,         -- output of core plan() — your audit trail
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at    TIMESTAMPTZ
);
```

**Why a ledger, not just an integer:** when a user says "I bought 30 coins and
only got 20 encodes," you need a row-by-row answer. Without it you will refund
out of pure uncertainty. The ledger is the balance; `nova_key.balance` is a cache
you can always rebuild with `SELECT SUM(delta)`.

---

## The critical rule: hold, then settle

Never decrement on job start and hope. Never decrement client-side, ever.

```
1. POST /api/nova/encode
   └─ BEGIN
      SELECT balance FROM nova_key WHERE id=$1 FOR UPDATE   -- row lock
      IF balance < cost → 402, ROLLBACK
      INSERT coin_ledger (delta=-cost, reason='encode_hold', job_id, idempotency)
      UPDATE nova_key SET balance = balance - cost
      INSERT encode_job (state='held')
      COMMIT
2. Encode runs.
3a. Delivered  → UPDATE encode_job SET state='delivered', settled_at=now()
3b. Failed     → INSERT coin_ledger (delta=+cost, reason='encode_refund')
                 UPDATE nova_key SET balance = balance + cost
                 UPDATE encode_job SET state='failed'
```

Plus a **sweeper**: any job stuck in `held`/`running` past 30 minutes is
auto-refunded. This one cron job eliminates most of your future support load.

`FOR UPDATE` is what stops a user firing 10 parallel requests with 3 coins and
getting 10 encodes. Without the row lock that race is trivially exploitable.

---

## Session as cache, not truth

```
POST /api/nova/activate  { key, turnstileToken }
  → verify Turnstile
  → rate limit: 5 attempts / 15 min / IP  (key guessing is the attack)
  → key_hash = sha256(normalise(key))
  → lookup; if missing or revoked → generic 401 "Key tidak valid atau sudah dicabut"
     (never distinguish "wrong key" from "revoked key" — that's an oracle)
  → Set-Cookie: nova_sid=<random 32B>; HttpOnly; Secure; SameSite=Lax; Max-Age=1209600; Path=/
  → server-side session store maps nova_sid → key_id
```

Cookie lost? User re-enters the key, balance is untouched. That is the whole fix.

**Key format:** `NOVA-XXXX-XXXX` is only ~16M combinations if alphanumeric-4.
That is brute-forceable. Use at least `NOVA-XXXXX-XXXXX-XXXXX` from a CSPRNG
with a Crockford base32 alphabet (no I/O/0/1), plus a check character so typos
fail client-side without hitting the server.

---

## Revocation that doesn't steal coins

"Session ends when the key is revoked" is correct — but revocation must not
silently vaporise a paid balance. Distinguish:

| Status | Login | Balance | Use |
|---|---|---|---|
| `active` | yes | spendable | normal |
| `suspended` | no | **preserved** | abuse investigation, reversible |
| `revoked` | no | frozen, refundable | confirmed fraud / user-requested |

If you revoke and delete the balance, that is the exact fact pattern that turns
a WhatsApp payment dispute into a public accusation. Preserve, then decide.

---

## Endpoints

| Route | Auth | Notes |
|---|---|---|
| `POST /api/nova/activate` | Turnstile + rate limit | Sets session. Generic errors only. |
| `GET  /api/nova/wallet` | session | `{balance, last4, recent[]}` — powers the wallet card |
| `POST /api/nova/encode` | session + idempotency key | Holds coins, returns `job_id` |
| `GET  /api/nova/job/:id` | session, must own job | Poll state |
| `POST /api/nova/logout` | session | Clears cookie only. **Never** touches balance. |

Hard rules:
- Every job read checks `job.key_id == session.key_id`. Otherwise `job_id` is an
  IDOR and anyone can enumerate other people's videos.
- `Cache-Control: no-store` on all of these.
- Log `key_id`, never the key.

---

## Wallet UI — fill the empty state

The card currently shows `——` / "WAITING FOR KEY". Once wired, show:

```
Available coin   12          Encodes used   6        Top-ups   2
                 ≈ 4 encodes
Recent
  −3   Reels HDR 1080p60      2 hrs ago
  +15  Top-up                 3 days ago
  +3   Refund — encode failed 4 days ago   ← builds more trust than anything else
```

Surfacing automatic refunds in the user's own ledger is the cheapest credibility
you will ever buy.

---

## Build order

1. Ledger table + `FOR UPDATE` hold/settle — **before** taking another payment.
   Retrofitting a ledger onto an integer balance means reconstructing history
   from memory.
2. Key-bound balance + re-entry restore.
3. Stuck-job sweeper cron.
4. Rate limit + longer key format.
5. Wallet history UI.
