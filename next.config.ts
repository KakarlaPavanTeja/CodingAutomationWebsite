import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    process.env.REPLIT_DEV_DOMAIN,
    ...(process.env.REPLIT_DOMAINS?.split(",") ?? []),
    // Allow LAN access so teammates can reach the dev server over the local network.
    "172.16.*.*",
  ].filter((d): d is string => Boolean(d)),
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
