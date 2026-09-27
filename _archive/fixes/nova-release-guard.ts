/**
 * /api/nova/encode/release  — HARDENED
 *
 * Closes the double-dip: hold 3 coins → receive the file → call /release →
 * get the coins back → repeat forever.
 *
 * Core rule: a job that has been DELIVERED can never be released.
 * Enforced in the WHERE clause of a single atomic UPDATE, not in JS.
 *
 * Stack assumed: Next.js App Router + node-postgres. Adapt the client, keep
 * the SQL shape — the safety lives in the SQL, not the framework.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

const FORBIDDEN = NextResponse.json(
  { error: 'Forbidden', code: 'FORBIDDEN' },
  { status: 403, headers: { 'Cache-Control': 'no-store' } },
);

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session?.keyId) return FORBIDDEN;

  let jobId: string, idem: string;
  try {
    const body = await req.json();
    jobId = String(body.jobId ?? '');
    // Idempotency: a retried release must not refund twice.
    idem = String(body.idempotencyKey ?? `release:${jobId}`);
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return FORBIDDEN;
  } catch {
    return FORBIDDEN;
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    /* ------------------------------------------------------------------
     * 1. Claim the job. This UPDATE is the entire security control.
     *
     *    - key_id match      → prevents releasing someone else's job (IDOR)
     *    - state IN (...)    → 'delivered' is ABSENT. A delivered job can
     *                          never be refunded, no matter what the client
     *                          sends. This is the double-dip fix.
     *    - RETURNING         → 0 rows means "not eligible", and because the
     *                          UPDATE is atomic, two concurrent releases
     *                          cannot both win.
     * ------------------------------------------------------------------ */
    const claim = await db.query(
      `UPDATE encode_job
          SET state = 'released', settled_at = now()
        WHERE id = $1
          AND key_id = $2
          AND state IN ('held', 'running', 'failed')   -- NOT 'delivered'
        RETURNING cost`,
      [jobId, session.keyId],
    );

    if (claim.rowCount === 0) {
      await db.query('ROLLBACK');
      // Deliberately generic: do not tell the caller whether the job was
      // already delivered, already released, or belongs to someone else.
      return FORBIDDEN;
    }

    const cost: number = claim.rows[0].cost;

    /* ------------------------------------------------------------------
     * 2. Write the refund to the ledger FIRST. The UNIQUE index on
     *    idempotency makes a duplicate refund impossible even if the client
     *    retries, the network replays, or a worker fires twice.
     * ------------------------------------------------------------------ */
    try {
      await db.query(
        `INSERT INTO coin_ledger (key_id, delta, reason, job_id, idempotency)
         VALUES ($1, $2, 'encode_refund', $3, $4)`,
        [session.keyId, cost, jobId, idem],
      );
    } catch (e: any) {
      if (e?.code === '23505') {        // unique_violation → already refunded
        await db.query('ROLLBACK');
        return NextResponse.json(
          { ok: true, alreadyRefunded: true },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }
      throw e;
    }

    /* ------------------------------------------------------------------
     * 3. Update the cached balance. Lock the row so this cannot interleave
     *    with a concurrent hold in /api/nova/encode.
     * ------------------------------------------------------------------ */
    const bal = await db.query(
      `UPDATE nova_key
          SET balance = balance + $2
        WHERE id = $1
        RETURNING balance`,
      [session.keyId, cost],
    );

    await db.query('COMMIT');

    return NextResponse.json(
      { ok: true, refunded: cost, balance: bal.rows[0].balance },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('[nova/release]', { jobId, keyId: session.keyId, err });
    return NextResponse.json(
      { error: 'Internal', code: 'INTERNAL' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    db.release();
  }
}

export async function GET() {
  return new NextResponse(null, { status: 405 });
}

/* ===========================================================================
 * COMPANION: the hold, in /api/nova/encode
 * The FOR UPDATE row lock is what stops 3 coins buying 10 parallel encodes.
 * See core/wallet-race-demo.js for a runnable demonstration of the attack.
 * ===========================================================================

await db.query('BEGIN');

const k = await db.query(
  `SELECT balance, status FROM nova_key WHERE id = $1 FOR UPDATE`,   // ← the lock
  [session.keyId],
);
if (k.rows[0]?.status !== 'active')      { await db.query('ROLLBACK'); return FORBIDDEN; }
if (k.rows[0].balance < cost)            { await db.query('ROLLBACK');
  return NextResponse.json({ error: 'Insufficient coins', code: 'NO_COINS' }, { status: 402 }); }

const job = await db.query(
  `INSERT INTO encode_job (id, key_id, cost, state, plan_json)
   VALUES (gen_random_uuid(), $1, $2, 'held', $3) RETURNING id`,
  [session.keyId, cost, planJson],          // planJson = output of core plan()
);

await db.query(
  `INSERT INTO coin_ledger (key_id, delta, reason, job_id, idempotency)
   VALUES ($1, $2, 'encode_hold', $3, $4)`,
  [session.keyId, -cost, job.rows[0].id, `hold:${job.rows[0].id}`],
);

await db.query(`UPDATE nova_key SET balance = balance - $2 WHERE id = $1`,
  [session.keyId, cost]);

await db.query('COMMIT');

 * ===========================================================================
 * COMPANION: /api/nova/encode/complete must be WORKER-authenticated, not
 * browser-callable. If the browser can declare a job complete, a user can
 * simply never call it and call /release instead.
 *
 *   - Require a shared secret / signed token from the encode worker
 *   - Or drop the endpoint entirely and have the worker write directly:
 *       UPDATE encode_job SET state='delivered', settled_at=now()
 *        WHERE id=$1 AND state='running';
 *
 * ===========================================================================
 * COMPANION: the sweeper (cron, every 5 min). Highest value-per-line in the
 * whole system — it removes most future support tickets before they exist.

WITH stuck AS (
  UPDATE encode_job SET state='failed', settled_at=now()
   WHERE state IN ('held','running') AND created_at < now() - interval '30 minutes'
  RETURNING id, key_id, cost
), refunded AS (
  INSERT INTO coin_ledger (key_id, delta, reason, job_id, idempotency)
  SELECT key_id, cost, 'encode_refund', id, 'sweep:' || id FROM stuck
  ON CONFLICT (idempotency) DO NOTHING
  RETURNING key_id, delta
)
UPDATE nova_key k SET balance = k.balance + r.total
  FROM (SELECT key_id, SUM(delta) AS total FROM refunded GROUP BY key_id) r
 WHERE k.id = r.key_id;

 * =========================================================================== */
