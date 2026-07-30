/**
 * Capture full-page screenshots of the live Market Vantage dashboard URL.
 *
 * - Local: full Playwright Chromium
 * - Vercel / serverless: @sparticuz/chromium + playwright-core
 *   (bundled Playwright browsers are not available on /var/task)
 */

import type { Browser, Page } from 'playwright-core';
import { dashboardCredentials } from '@/lib/sessionAuth';

/** Minimal sub shape for URL + capture (avoids circular import with alertReport). */
export interface ScreenshotSub {
  all_clients: boolean;
  clients: string[];
  all_business_lines: boolean;
  business_lines: string[];
}

/** Optional focus derived from the new event(s) — e.g. Newegg / Rogers. */
export interface ScreenshotFocus {
  client?: string;
  line?: string;
  tab?: 'overview' | 'competitor';
  range?: '7d' | '30d' | '90d' | 'All';
  eventOnly?: boolean;
}

export interface DashboardShot {
  filename: string;
  label: string;
  buffer: Buffer;
  contentType: 'image/png';
  width: number;
  height: number;
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  ).replace(/\/$/, '');
}

function isServerless(): boolean {
  return !!(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.AWS_EXECUTION_ENV
  );
}

function pngDimensions(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') {
    return { width: 1440, height: 900 };
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

export function dashboardUrlForSubscription(
  sub: ScreenshotSub,
  tab?: 'overview' | 'competitor',
  focus?: ScreenshotFocus,
): string {
  const base = appBaseUrl();
  const u = new URL('/dashboard', base);
  const effectiveTab = focus?.tab || tab || 'overview';
  if (effectiveTab === 'competitor') u.searchParams.set('tab', 'competitor');

  const client =
    focus?.client ||
    (!sub.all_clients && sub.clients?.length === 1 ? sub.clients[0] : undefined);
  if (client) u.searchParams.set('client', client);

  const line =
    focus?.line ||
    (!sub.all_business_lines && sub.business_lines?.length === 1
      ? sub.business_lines[0]
      : undefined);
  if (line) u.searchParams.set('line', line);

  u.searchParams.set('range', focus?.range || '7d');
  u.searchParams.set('screenshot', '1');
  return u.toString();
}

async function launchBrowser(): Promise<Browser> {
  if (isServerless()) {
    // Lightweight Chromium binary for AWS Lambda / Vercel
    const chromium = (await import('@sparticuz/chromium')).default;
    const { chromium: playwrightChromium } = await import('playwright-core');
    const executablePath = await chromium.executablePath();
    console.log('[screenshot] Launching serverless Chromium at', executablePath);
    return playwrightChromium.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    });
  }

  // Local / long-running hosts: full Playwright install
  const { chromium } = await import('playwright');
  return chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
      '--disable-gpu',
    ],
  });
}

async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await launchBrowser();
  try {
    return await fn(browser);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function waitForDashboardReady(page: Page) {
  try {
    await page.waitForSelector('[data-dashboard-ready="true"]', { timeout: 45_000 });
  } catch {
    await page.waitForSelector('.mv-app-shell', { timeout: 20_000 });
  }
  // Charts settle (shorter on serverless to stay under function limits)
  await page.waitForTimeout(isServerless() ? 2000 : 3500);
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 300));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
  });
}

/**
 * Sign in via the real login API, then capture full-page PNG(s) of the live UI.
 */
export async function captureDashboardScreenshots(
  sub: ScreenshotSub,
  focus?: ScreenshotFocus,
): Promise<DashboardShot[]> {
  const base = appBaseUrl();
  const { username, password } = dashboardCredentials();
  const eventOnly = focus?.eventOnly !== false && !!focus?.client;
  const scale = isServerless() ? 1 : 2;

  return withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: scale,
      reducedMotion: 'reduce',
    });

    const page = await context.newPage();

    const loginRes = await page.request.post(`${base}/api/auth/login`, {
      data: { username, password },
      headers: { 'Content-Type': 'application/json' },
    });
    if (!loginRes.ok()) {
      const body = await loginRes.text().catch(() => '');
      throw new Error(
        `Screenshot login failed HTTP ${loginRes.status()}: ${body.slice(0, 200)}`,
      );
    }

    const shots: DashboardShot[] = [];

    const capture = async (url: string, filename: string, label: string) => {
      console.log(`[screenshot] Opening ${url}`);
      const res = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: isServerless() ? 45_000 : 90_000,
      });
      if (res && res.status() >= 400) {
        throw new Error(`Dashboard returned HTTP ${res.status()} for ${url}`);
      }
      if (page.url().includes('/sign-in')) {
        throw new Error(
          `Screenshot landed on sign-in instead of dashboard (${page.url()}). Login cookie not accepted.`,
        );
      }
      await waitForDashboardReady(page);
      // Viewport shot on serverless (faster/smaller); full page locally
      const buffer = Buffer.from(
        await page.screenshot({
          fullPage: !isServerless(),
          type: 'png',
          animations: 'disabled',
        }),
      );
      const { width, height } = pngDimensions(buffer);
      console.log(`[screenshot] Captured ${filename} ${width}x${height} (${buffer.length} bytes)`);
      shots.push({
        filename,
        label,
        buffer,
        contentType: 'image/png',
        width,
        height,
      });
    };

    if (eventOnly) {
      const tab = focus?.tab || 'overview';
      const labelClient = focus?.client || 'event';
      const safe = labelClient.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 40);
      await capture(
        dashboardUrlForSubscription(sub, tab, focus),
        `market-vantage-${safe}.png`,
        `Dashboard · ${labelClient}${focus?.line ? ` · ${focus.line}` : ''}`,
      );
    } else {
      await capture(
        dashboardUrlForSubscription(sub, 'overview', focus),
        'market-vantage-overview.png',
        'Dashboard · Overview',
      );
      // Second tab only when not serverless (time/memory)
      if (!isServerless()) {
        await capture(
          dashboardUrlForSubscription(sub, 'competitor', focus),
          'market-vantage-competitor.png',
          'Dashboard · Competitor Analysis',
        );
      }
    }

    await context.close();
    if (!shots.length) {
      throw new Error('No dashboard screenshots were captured');
    }
    return shots;
  });
}

/** Embed screenshots into a multi-page PDF. */
export async function screenshotsToPdf(shots: DashboardShot[]): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (!shots.length) {
      doc.addPage({ size: 'LETTER', margin: 48 });
      doc.fontSize(14).text('No screenshots captured.');
      doc.end();
      return;
    }

    for (const shot of shots) {
      const maxPageW = 792;
      const maxPageH = 1008;
      const scale = Math.min(1, maxPageW / shot.width);
      const scaledW = shot.width * scale;
      const scaledH = shot.height * scale;

      if (scaledH <= maxPageH) {
        doc.addPage({ size: [scaledW, scaledH], margin: 0 });
        doc.image(shot.buffer, 0, 0, { width: scaledW, height: scaledH });
      } else {
        const pageCount = Math.ceil(scaledH / maxPageH);
        for (let i = 0; i < pageCount; i++) {
          const sliceH = Math.min(maxPageH, scaledH - i * maxPageH);
          doc.addPage({ size: [scaledW, sliceH], margin: 0 });
          doc.save();
          doc.rect(0, 0, scaledW, sliceH).clip();
          doc.image(shot.buffer, 0, -i * maxPageH, {
            width: scaledW,
            height: scaledH,
          });
          doc.restore();
        }
      }
    }

    doc.end();
  });
}
