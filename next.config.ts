import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/font assets resolvable at runtime (Playwright, PDFKit AFM fonts)
  serverExternalPackages: ["playwright", "playwright-core", "pdfkit", "fontkit"],
};

export default nextConfig;
