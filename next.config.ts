import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / large server-only packages — do not bundle into the serverless graph incorrectly
  serverExternalPackages: [
    "@sparticuz/chromium",
    "puppeteer-core",
    "playwright",
    "playwright-core",
    "pdfkit",
    "fontkit",
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
