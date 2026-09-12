import type { NextConfig } from "next";
import path from "node:path";

const isProd = process.env.NODE_ENV === "production";

/** Headers applied to every response (CSP itself is set per request in src/proxy.ts). */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: path.join(__dirname),
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // Secret store-report links must never leak through the Referer header.
      { source: "/r/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      // Admin and account pages are never cached by shared caches.
      { source: "/admin/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/account/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/dashboard/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default nextConfig;
