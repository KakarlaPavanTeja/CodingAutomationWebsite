import type { NextConfig } from "next";

/** Tunnel hostnames change per session; wildcards cover free + paid tiers. */
const TUNNEL_DEV_ORIGINS = [
  "*.ngrok-free.dev",
  "*.ngrok-free.app",
  "*.ngrok.io",
  "*.ngrok.app",
  "*.trycloudflare.com",
];

/**
 * `src/proxy.ts` buffers request bodies, and Next caps that at 10 MB by default —
 * which silently truncated large /api/files/save posts. Next requires a concrete
 * limit (>= 1 byte; there is no "unlimited"), so mirror the route's own cap in
 * src/app/api/files/save/route.ts and honour the same env override.
 */
const CLIENT_MAX_BODY_BYTES = (() => {
  const fromEnv = parseInt(process.env.FILE_SAVE_MAX_BYTES || "", 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 256 * 1024 * 1024;
})();

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    process.env.REPLIT_DEV_DOMAIN,
    ...(process.env.REPLIT_DOMAINS?.split(",") ?? []),
    process.env.NGROK_DOMAIN,
    ...(process.env.ALLOWED_DEV_ORIGINS?.split(",") ?? []),
    ...TUNNEL_DEV_ORIGINS,
    // Allow LAN access so teammates can reach the dev server over the local network.
    "172.16.*.*",
  ]
    .map((d) => d?.trim())
    .filter((d): d is string => Boolean(d)),
  experimental: {
    authInterrupts: true,
    proxyClientMaxBodySize: CLIENT_MAX_BODY_BYTES,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
