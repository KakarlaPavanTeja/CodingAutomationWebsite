import type { NextConfig } from "next";

/** ngrok tunnel hostnames change per session; wildcards cover free + paid tiers. */
const NGROK_DEV_ORIGINS = [
  "*.ngrok-free.dev",
  "*.ngrok-free.app",
  "*.ngrok.io",
  "*.ngrok.app",
];

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    process.env.REPLIT_DEV_DOMAIN,
    ...(process.env.REPLIT_DOMAINS?.split(",") ?? []),
    process.env.NGROK_DOMAIN,
    ...(process.env.ALLOWED_DEV_ORIGINS?.split(",") ?? []),
    ...NGROK_DEV_ORIGINS,
    // Allow LAN access so teammates can reach the dev server over the local network.
    "172.16.*.*",
  ]
    .map((d) => d?.trim())
    .filter((d): d is string => Boolean(d)),
  experimental: {
    authInterrupts: true,
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
