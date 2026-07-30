import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/font assets resolvable at runtime (Playwright, serverless Chromium, PDFKit)
  serverExternalPackages: [
    "playwright",
    "playwright-core",
    "@sparticuz/chromium",
    "pdfkit",
    "fontkit",
  ],
};

export default nextConfig;
