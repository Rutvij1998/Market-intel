/**
 * Capture exact full-page screenshots of the live Market Vantage dashboard URL
 * (what a signed-in user sees in the browser).
 *
 * Signs in via POST /api/auth/login so the session cookie always matches the
 * running server's AUTH_SECRET / CRON_SECRET (forging cookies is fragile).
 */

import { chromium, type Browser, type Page } from 'playwright';
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
  /** Prefer overview | competitor; default overview for client events */
  tab?: 'overview' | 'competitor';
  range?: '7d' | '30d' | '90d' | 'All';
  /** Capture only the event-focused page (default true for alerts) */
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

/** Read PNG IHDR width/height without extra deps. */
function pngDimensions(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') {
    return { width: 1440, height: 900 };
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

/** Build /dashboard URL reflecting subscription + event focus when possible. */
export function dashboardUrlForSubscription(
  sub: ScreenshotSub,
  tab?: 'overview' | 'competitor',
  focus?: ScreenshotFocus,
): string {
  const base = appBaseUrl();
  const u = new URL('/dashboard', base);
  const effectiveTab = focus?.tab || tab || 'overview';
  if (effectiveTab === 'competitor') u.searchParams.set('tab', 'competitor');

  // Event client (e.g. Newegg) wins; else single subscription client
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

async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
      '--disable-gpu',
    ],
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function waitForDashboardReady(page: Page) {
  try {
    await page.waitForSelector('[data-dashboard-ready="true"]', { timeout: 60_000 });
  } catch {
    await page.waitForSelector('.mv-app-shell', { timeout: 30_000 });
  }
  // Charts / fonts / second paint
  await page.waitForTimeout(3500);
  // Scroll so lazy layout measures, then back to top
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 400));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
  });
}

/**
 * Sign in via the real login API, then capture full-page PNG(s) of the live UI.
 * For event alerts, pass `focus` so the screenshot matches the new thread’s client/line.
 */
export async function captureDashboardScreenshots(
  sub: ScreenshotSub,
  focus?: ScreenshotFocus,
): Promise<DashboardShot[]> {
  const base = appBaseUrl();
  const { username, password } = dashboardCredentials();
  const eventOnly = focus?.eventOnly !== false && !!focus?.client;

  return withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2, // sharper email / PDF
      reducedMotion: 'reduce',
    });

    const page = await context.newPage();

    // Real login — cookie is issued by the same process that verifies it
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
        timeout: 90_000,
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
      const buffer = Buffer.from(
        await page.screenshot({
          fullPage: true,
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
      await capture(
        dashboardUrlForSubscription(sub, 'competitor', focus),
        'market-vantage-competitor.png',
        'Dashboard · Competitor Analysis',
      );
    }

    await context.close();
    if (!shots.length) {
      throw new Error('No dashboard screenshots were captured');
    }
    return shots;
  });
}

/**
 * Embed live screenshots into a PDF at near-native resolution.
 * Each PNG becomes one or more pages (sliced vertically if taller than ~11").
 * No text dump — pure pixel capture of the live URL.
 */
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
      // PDF points at 72dpi. Fit to landscape letter width; slice tall captures.
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
