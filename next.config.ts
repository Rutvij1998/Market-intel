import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const dir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: dir,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' http://127.0.0.1:4210 http://localhost:4210",
          },
        ],
      },
    ];
  },
  // Native / large server-only packages — do not bundle into the serverless graph incorrectly
  serverExternalPackages: [
    "@sparticuz/chromium",
    "puppeteer-core",
    "playwright",
    "playwright-core",
  ],
  // Ensure Chromium binary assets are traced into the serverless function
  outputFileTracingIncludes: {
    "/api/notifications/run": [
      "./node_modules/@sparticuz/chromium/**/*",
    ],
    "/api/cron/ingest": [
      "./node_modules/@sparticuz/chromium/**/*",
    ],
  },
};

export default nextConfig;
