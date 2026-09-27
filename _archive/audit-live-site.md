# Live Site Audit — transcode.vague-infinity.com
**Audited:** 26 Sep 2026 · Next.js (Turbopack) on Cloudflare · prerendered, `x-nextjs-cache: HIT`

Note: the live HTML still serves the **old dark build** (Pulse-only copy, "HDR belum
didukung"). The neo-brutalist Nova build in your screenshot is not what anonymous
visitors get — either an uncached deploy, a staged branch, or a local build.
**The Nova API, however, is live and responding.**

---

## 🔴 CRITICAL

### 1. Plain HTTP serves the entire site — no redirect, no HSTS

```
$ curl -sI http://transcode.vague-infinity.com/
HTTP/1.1 200 OK          ← serves content, does NOT redirect to HTTPS
```

And every security header is absent:

| Header | Status |
|---|---|
| `strict-transport-security` | ❌ missing |
| `content-security-policy` | ❌ missing |
| `x-frame-options` | ❌ missing |
| `x-content-type-options` | ❌ missing |
| `referrer-policy` | ❌ missing |
| `permissions-policy` | ❌ missing |
| `cross-origin-opener-policy` | ❌ missing |

**Why this is critical now specifically:** you are about to put a paid session
cookie on this domain. With HTTP serving 200 and no HSTS, a user on café/hotel
Wi-Fi can be served a downgraded page. If the Nova cookie ever lacks the `Secure`
flag it transmits in cleartext; even with `Secure`, an attacker can serve a fake
login form on `http://` that looks identical and harvest Nova keys. Keys are
worth money — this is now a financial attack surface, not a theoretical one.

**Fix (30 minutes, all in Cloudflare dashboard + `next.config.js`):**

```js
// next.config.js
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://vague-infinity.com https://www.googletagmanager.com",
  "font-src 'self' data:",
  "connect-src 'self' https://www.google-analytics.com https://cloudflareinsights.com",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join('; ');

module.exports = {
  poweredByHeader: false,                       // removes x-powered-by: Next.js
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
        { key: 'Content-Security-Policy',   value: csp },
        { key: 'X-Frame-Options',           value: 'DENY' },
        { key: 'X-Content-Type-Options',    value: 'nosniff' },
        { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
        { key: 'Cross-Origin-Opener-Policy',value: 'same-origin' },
      ],
    }];
  },
};
```

Plus in Cloudflare: **SSL/TLS → Edge Certificates → Always Use HTTPS: ON**, and
**Automatic HTTPS Rewrites: ON**. Do the Cloudflare toggle first — it's one click
and closes the hole immediately.

---

### 2. Coin settlement is client-callable — verify it can't be double-dipped

The bundle exposes your Nova flow:

```
/api/nova/session
/api/nova/encode
/api/nova/encode/complete     ← settle
/api/nova/encode/release      ← refund the hold
/api/transcode/access
/api/encode-config
```

**Good news:** this is a proper hold → settle/release pattern. You already built
what I was about to spec. All three correctly return `403 {"error":"Forbidden"}`
unauthenticated — they fail closed. That's solid.

**The thing to verify immediately:** can a client call `/release` *after* the
encoded file has been delivered?

```
1. POST /api/nova/encode           → holds 3 coins, job starts
2. …encode completes, user downloads the MP4…
3. POST /api/nova/encode/release   → refunds 3 coins
   = free GPU encode, repeatable forever
```

`release` must be rejected when `job.state == 'delivered'`, and the state
transition must be server-authoritative — driven by your worker finishing, never
by a client POST. If `/complete` is what the *browser* calls after downloading,
then a user who simply never calls it, and calls `/release` instead, encodes free.

**Test it yourself with a real key:** run the sequence above and check whether the
balance returns. If it does, that's your revenue leak. Fix:

```sql
UPDATE encode_job SET state='released'
 WHERE id=$1 AND key_id=$2 AND state IN ('held','failed')   -- never 'delivered'
RETURNING cost;                                             -- 0 rows = reject
```

Also confirm `/api/nova/encode` enforces `SELECT ... FOR UPDATE` — see
`core/wallet-race-demo.js`, which shows 3 coins buying 10 encodes without it.

---

## 🟡 IMPORTANT

### 3. Homepage is `no-store` — you're paying for a CDN you can't use

```
cache-control: no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0
pragma: no-cache
expires: 0
cf-cache-status: DYNAMIC
```

This is a **static marketing page**. `no-store` means every repeat visitor
re-downloads 26 KB of HTML and Cloudflare never caches it at the edge — from
Indonesia, that's a round trip to your origin on every single load. It also
slightly hurts Core Web Vitals, which feeds your SEO strategy.

Your static assets are configured perfectly (`max-age=31536000, immutable`,
`cf-cache-status: HIT`, age 153118s) — so this looks like a global `no-store`
applied to fix a Nova-session caching bug, hitting the whole site as collateral.

**Fix:** scope it. Marketing pages get
`public, s-maxage=3600, stale-while-revalidate=86400`; only `/api/nova/*` and any
authenticated route get `no-store`.

### 4. Orphan page: `/core`

`/core` returns 200, is in your sitemap at priority 0.8, and has the most recent
`lastmod` of any page (2026-09-11). It is linked from **zero** places on the
homepage. Title: *"Vague Core | Channel & Transcode Video"*.

An orphan page with no internal links gets crawled but ranks poorly — Google reads
internal linking as an importance signal. Either link it from the footer nav, or
drop it from the sitemap. Right now it's doing neither job.

Also: every other `lastmod` says 2026-08-14 despite a full visual redesign since.
Stale `lastmod` values train Google to re-crawl you less often.

### 5. Brotli appears to be off

```
Accept-Encoding: br,gzip  →  content-encoding: gzip
```

Cloudflare supports Brotli and it beats gzip by roughly 15–20% on JS. You're
shipping ~190 KB gzipped of JS; Brotli would cut ~30 KB from every cold load.
One toggle: **Speed → Optimization → Brotli**.

### 6. Bundle: 664 KB raw / ~190 KB wire, and 109 KB of it is dead weight

| Chunk | Raw | Note |
|---|---|---|
| `33wmmxu2kkyqh.js` | 222 KB | main app |
| `0f56hu2yz48k2.js` | 174 KB | framework |
| `0cz1d0mv5g_q7.js` | **109 KB** | **`noModule` legacy bundle** |
| 7 others | 159 KB | |

The 109 KB `noModule` chunk only executes in browsers that don't support ES
modules — essentially IE11 and pre-2018 Safari. For an Indonesian mobile audience
in 2026 that's a rounding error. Raising your browserslist target removes it
entirely.

The 66 KB CSS file is also large for this design; run DevTools **Coverage** (it
showed `N/A` in your screenshot — you never recorded a session) to see how much is
unused.

---

## 🟢 CLEAN

- **No secrets in the bundle.** Scanned all 664 KB for `sk_live`, `AIza*`, `AKIA*`,
  `ghp_*`, PEM blocks — **zero hits**. Genuinely well done; this is the most common
  way small teams get burned.
- **Nova endpoints fail closed** with a generic `{"error":"Forbidden","code":"FORBIDDEN"}`.
  No user enumeration, no stack traces, no distinction between "bad key" and
  "revoked key". Correct.
- **404s are clean** — `/.env`, `/nova`, `/pricing` all return the styled 404 with
  no path disclosure.
- **`/api/transcode` returns 405** on GET rather than an error page — correct method
  gating.
- **Static asset caching is textbook**: immutable, 1-year, edge HIT.
- **robots.txt + sitemap.xml** both present and well-formed.
- **Manifest** is valid with maskable icons — installable PWA.
- All 6 legal/support pages exist and are substantial (28–50 KB): `/faq`, `/support`,
  `/privacy`, `/terms`, `/data-retention`, `/tiktok-checker`.

---

## Minor

- `x-powered-by: Next.js` — free recon for an attacker. `poweredByHeader: false`.
- `x-nextjs-prerender: 1` is emitted **twice**. Harmless, but suggests a duplicated
  header rule somewhere in your config worth finding.
- Google Fonts (`fonts.googleapis.com` / `gstatic.com`) still loaded remotely — a
  privacy claim problem given you publish a `/privacy` page, and two render-blocking
  connections. Self-host Bangers + Nunito as woff2.

---

## Priority order

| # | Action | Time | Risk if skipped |
|---|---|---|---|
| 1 | Cloudflare **Always Use HTTPS** toggle | 1 min | Key theft over HTTP |
| 2 | Security headers via `next.config.js` | 30 min | Clickjacking, XSS, downgrade |
| 3 | **Verify `/release` rejects delivered jobs** | 1 hr | Unlimited free GPU encodes |
| 4 | Confirm `FOR UPDATE` on the coin hold | 1 hr | 3 coins → 10 encodes |
| 5 | Scope `no-store` to API routes only | 30 min | Slow repeat loads, CDN unused |
| 6 | Enable Brotli | 1 min | ~30 KB wasted per load |
| 7 | Link or delist `/core`; refresh `lastmod` | 15 min | Wasted crawl budget |
| 8 | Drop the `noModule` legacy bundle | 30 min | 109 KB dead weight |

Items 1, 2, 6 are under 35 minutes combined and close the entire security gap.
Items 3 and 4 protect the only part of this that costs you real money.
