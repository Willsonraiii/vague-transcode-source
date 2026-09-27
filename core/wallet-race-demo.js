/**
 * Demonstrates the double-spend race in a check-then-decrement wallet,
 * and that a row lock fixes it. Run: node core/wallet-race-demo.js
 */
'use strict';

const COST = 3, START = 3, PARALLEL = 10;
const tick = () => new Promise(r => setImmediate(r)); // simulates DB await

// ---- NAIVE: read, await, write (what most first drafts do) -----------------
async function naive() {
  let balance = START, granted = 0;
  const attempt = async () => {
    const b = balance;          // SELECT
    await tick();               // network hop to DB — the race window
    if (b < COST) return;
    balance = b - COST;         // UPDATE
    granted++;
  };
  await Promise.all(Array.from({ length: PARALLEL }, attempt));
  return { granted, balance };
}

// ---- LOCKED: serialise per key (SELECT ... FOR UPDATE) ---------------------
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => {}));
  return next;
}

async function locked() {
  let balance = START, granted = 0;
  const attempt = () => withLock('key-1', async () => {
    const b = balance;
    await tick();
    if (b < COST) return;
    balance = b - COST;
    granted++;
  });
  await Promise.all(Array.from({ length: PARALLEL }, attempt));
  return { granted, balance };
}

(async () => {
  const paid = START / COST;
  const n = await naive();
  const l = await locked();

  console.log(`\n  Balance ${START} coins · ${COST} coins/encode · ${PARALLEL} parallel requests`);
  console.log(`  User paid for ${paid} encode${paid === 1 ? '' : 's'}.\n`);
  console.log(`  NAIVE   granted ${n.granted} encodes, balance ended ${n.balance}`);
  console.log(`  LOCKED  granted ${l.granted} encodes, balance ended ${l.balance}\n`);

  const stolen = n.granted - Math.floor(paid);
  console.log(stolen > 0
    ? `  ❌ Naive path gave away ${stolen} free GPU encode${stolen === 1 ? '' : 's'} — and left the balance at ${n.balance}.`
    : `  (no race observed this run — timing dependent, which is exactly why it's dangerous)`);
  console.log(`  ✅ Locked path granted exactly ${Math.floor(paid)}, the amount paid for.\n`);
  console.log(`  Real fix: SELECT balance FROM nova_key WHERE id=$1 FOR UPDATE\n` +
              `  inside the same transaction as the ledger INSERT.\n`);
})();
