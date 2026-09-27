/**
 * Vague Transcode — drop-in security + caching config
 * Replaces your existing next.config.js (merge if you have custom settings).
 *
 * Closes: missing HSTS/CSP/XFO/nosniff, x-powered-by leak, and the
 * site-wide `no-store` that prevents Cloudflare from caching marketing pages.
 *
 * ⚠ Do the Cloudflare toggles too — they are not replaceable by this file:
 *    SSL/TLS → Edge Certificates → Always Use HTTPS: ON
 *    SSL/TLS → Edge Certificates → Automatic HTTPS Rewrites: ON
 *    Speed → Optimization → Brotli: ON
 */

const isDev = process.env.NODE_ENV !== 'production';

// Keep this list tight. Every origin here is one you actually load.
const csp = [
  "default-src 'self'",
  // 'unsafe-inline' is required by Next's inline bootstrap script.
  // Remove it later by adopting nonces (see note at bottom).
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://www.googletagmanager.com https://challenges.cloudflare.com https://static.cloudflareinsights.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://vague-infinity.com https://www.googletagmanager.com https://www.google-analytics.com",
  "font-src 'self' data:",                       // self-host fonts; no gstatic
  "media-src 'self' blob:",                      // blob: = Pulse in-browser output
  "worker-src 'self' blob:",                     // ffmpeg.wasm workers
  "child-src 'self' blob:",
  "connect-src 'self' blob: https://www.google-analytics.com https://cloudflareinsights.com https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com", // Turnstile
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ');

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

/** @type {import('next').NextConfig} */
module.exports = {
  poweredByHeader: false,           // kills `x-powered-by: Next.js`
  reactStrictMode: true,
  compress: true,

  async headers() {
    return [
      // 1. Security headers everywhere.
      { source: '/:path*', headers: securityHeaders },

      // 2. Marketing pages — LET CLOUDFLARE CACHE THESE.
      //    This is the fix for the site-wide `no-store`.
      {
        source: '/((?!api/).*)',
        headers: [
          { key: 'Cache-Control', value: 'public, s-maxage=3600, stale-while-revalidate=86400' },
        ],
      },

      // 3. Anything authenticated or money-touching — never cache, anywhere.
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Vary', value: 'Cookie' },
        ],
      },

      // 4. Immutable build assets (already correct on your site — preserved).
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },

  async redirects() {
    return [
      // Orphan-page cleanup: either link /core in the footer, or 301 it home.
      // Uncomment if you decide to retire it rather than link it.
      // { source: '/core', destination: '/', permanent: true },
    ];
  },
};

/*
 * NEXT STEP (optional, ~1h): remove 'unsafe-inline' from script-src.
 * Generate a per-request nonce in middleware.ts, pass it to the CSP header and
 * to next/script via the `nonce` prop. Until then 'unsafe-inline' is the
 * pragmatic choice — every other directive above still provides real protection.
 */
