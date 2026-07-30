/**
 * Capture screenshots of the live Market Vantage dashboard URL.
 *
 * Local: Playwright (full install)
 * Vercel/serverless: puppeteer-core + @sparticuz/chromium
 *
 * Screenshots always use range=All by default so the image is not empty when
 * recent windows (7d) have no new threads.
 */

import { dashboardCredentials } from '@/lib/sessionAuth';

export interface ScreenshotSub {
  all_clients: boolean;
  clients: string[];
  all_business_lines: boolean;
  business_lines: string[];
}

export interface ScreenshotFocus {
  client?: string;
  line?: string;
  tab?: 'overview' | 'competitor';
  range?: '7d' | '30d' | '90d' | 'All';
  eventOnly?: boolean;
  /** When true (default for alerts), skip business-line filter so the shot has data */
  skipLineFilter?: boolean;
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

/**
 * Build dashboard URL for screenshots / deep links.
 * Defaults to range=All so empty 7d windows are avoided.
 */
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

  // Line filters often zero-out the board; only apply when explicitly requested
  const skipLine = focus?.skipLineFilter !== false;
  if (!skipLine) {
    const line =
      focus?.line ||
      (!sub.all_business_lines && sub.business_lines?.length === 1
        ? sub.business_lines[0]
        : undefined);
    if (line) u.searchParams.set('line', line);
  }

  // Never default to 7d for captures — stale ingest makes that empty
  const range = focus?.range && focus.range !== '7d' ? focus.range : 'All';
  u.searchParams.set('range', range);
  u.searchParams.set('screenshot', '1');
  return u.toString();
}

function shotFromPng(buffer: Buffer, filename: string, label: string): DashboardShot {
  const { width, height } = pngDimensions(buffer);
  console.log(`[screenshot] Captured ${filename} ${width}x${height} (${buffer.length} bytes)`);
  return {
    filename,
    label,
    buffer,
    contentType: 'image/png',
    width,
    height,
  };
}

async function loginCookies(base: string): Promise<{ name: string; value: string }[]> {
  const { username, password } = dashboardCredentials();
  const nodeLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!nodeLogin.ok) {
    const body = await nodeLogin.text().catch(() => '');
    throw new Error(`Screenshot login failed HTTP ${nodeLogin.status}: ${body.slice(0, 200)}`);
  }
  const setCookie = nodeLogin.headers.getSetCookie?.() || [];
  const cookieHeader = nodeLogin.headers.get('set-cookie');
  const rawCookies =
    setCookie.length > 0
      ? setCookie
      : cookieHeader
        ? cookieHeader.split(/,(?=\s*[^;]+=)/)
        : [];

  const out: { name: string; value: string }[] = [];
  for (const raw of rawCookies) {
    const [pair] = raw.split(';');
    const eq = pair?.indexOf('=') ?? -1;
    if (eq < 0) continue;
    const name = pair!.slice(0, eq).trim();
    const value = pair!.slice(eq + 1).trim();
    if (name) out.push({ name, value });
  }
  return out;
}

/** True if the live page looks empty (no chart data). */
async function pageLooksEmpty(getText: () => Promise<string>): Promise<boolean> {
  const text = await getText();
  if (/No real data yet/i.test(text)) return true;
  if (/No data in current filter/i.test(text)) return true;
  if (/No source data in this window/i.test(text) && /LIKEWIZE MENTIONS[\s\S]{0,40}\b0\b/i.test(text)) {
    return true;
  }
  // KPI strip showing zeros for main count
  if (/LIKEWIZE MENTIONS\s*0\b/i.test(text) && /POSITIVE SENTIMENT\s*0%/i.test(text)) {
    return true;
  }
  return false;
}

type Target = { url: string; filename: string; label: string };

function buildTargets(sub: ScreenshotSub, focus?: ScreenshotFocus): Target[] {
  const eventOnly = focus?.eventOnly !== false && !!focus?.client;
  const baseFocus: ScreenshotFocus = {
    ...focus,
    range: 'All',
    skipLineFilter: true,
  };

  if (eventOnly) {
    const tab = focus?.tab || 'overview';
    const labelClient = focus?.client || 'event';
    const safe = labelClient.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 40);
    return [
      {
        url: dashboardUrlForSubscription(sub, tab, { ...baseFocus, client: focus?.client }),
        filename: `market-vantage-${safe}.png`,
        label: `Dashboard · ${labelClient} · All dates`,
      },
      // Fallback: unfiltered overview if client filter is empty
      {
        url: dashboardUrlForSubscription(sub, 'overview', {
          range: 'All',
          skipLineFilter: true,
          eventOnly: false,
        }),
        filename: `market-vantage-${safe}-fallback.png`,
        label: 'Dashboard · Overview · All dates',
      },
    ];
  }

  return [
    {
      url: dashboardUrlForSubscription(sub, 'overview', baseFocus),
      filename: 'market-vantage-overview.png',
      label: 'Dashboard · Overview · All dates',
    },
  ];
}

async function settleDashboard(
  waitForSelector: (sel: string, opts: { timeout: number }) => Promise<unknown>,
  waitMs: (ms: number) => Promise<void>,
) {
  try {
    await waitForSelector('[data-dashboard-ready="true"]', { timeout: 45_000 });
  } catch {
    await waitForSelector('.mv-app-shell', { timeout: 20_000 });
  }
  // Let Recharts + filters re-render after deep-link state applies
  await waitMs(isServerless() ? 3500 : 4500);
}

/** Puppeteer + @sparticuz/chromium — Vercel/Lambda. */
async function captureWithPuppeteer(targets: Target[]): Promise<DashboardShot[]> {
  const chromium = (await import('@sparticuz/chromium')).default;
  const puppeteer = (await import('puppeteer-core')).default;
  const base = appBaseUrl();
  const cookies = await loginCookies(base);
  const host = new URL(base).hostname;

  const executablePath = await chromium.executablePath();
  console.log('[screenshot] serverless puppeteer chromium:', executablePath);

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    executablePath,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    for (const c of cookies) {
      await page.setCookie({
        name: c.name,
        value: c.value,
        domain: host,
        path: '/',
        httpOnly: true,
        secure: base.startsWith('https'),
        sameSite: 'Lax',
      });
    }

    let chosen: Target | null = null;
    for (const t of targets) {
      console.log(`[screenshot] Opening ${t.url}`);
      const res = await page.goto(t.url, {
        waitUntil: 'domcontentloaded',
        timeout: 50_000,
      });
      if (res && res.status() >= 400) {
        console.warn(`[screenshot] HTTP ${res.status()} for ${t.url}`);
        continue;
      }
      if (page.url().includes('/sign-in')) {
        throw new Error(`Screenshot landed on sign-in (${page.url()})`);
      }
      await settleDashboard(
        (sel, opts) => page.waitForSelector(sel, opts),
        (ms) => new Promise((r) => setTimeout(r, ms)),
      );
      const empty = await pageLooksEmpty(() => page.evaluate(() => document.body.innerText));
      if (empty) {
        console.warn(`[screenshot] Empty UI for ${t.url} — trying next URL`);
        continue;
      }
      chosen = t;
      break;
    }

    // Last resort: capture whatever we have (prefer last target = broadest)
    if (!chosen) {
      const t = targets[targets.length - 1]!;
      console.warn(`[screenshot] All targets looked empty; capturing fallback ${t.url}`);
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 50_000 });
      await settleDashboard(
        (sel, opts) => page.waitForSelector(sel, opts),
        (ms) => new Promise((r) => setTimeout(r, ms)),
      );
      chosen = t;
    }

    const png = Buffer.from(await page.screenshot({ type: 'png', fullPage: false }));
    return [shotFromPng(png, chosen.filename.replace(/-fallback/, ''), chosen.label)];
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** Full Playwright — local/dev only. */
async function captureWithPlaywright(targets: Target[]): Promise<DashboardShot[]> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const base = appBaseUrl();
    const { username, password } = dashboardCredentials();

    const loginRes = await page.request.post(`${base}/api/auth/login`, {
      data: { username, password },
      headers: { 'Content-Type': 'application/json' },
    });
    if (!loginRes.ok()) {
      const body = await loginRes.text().catch(() => '');
      throw new Error(`Screenshot login failed HTTP ${loginRes.status()}: ${body.slice(0, 200)}`);
    }

    let chosen: Target | null = null;
    for (const t of targets) {
      console.log(`[screenshot] Opening ${t.url}`);
      const res = await page.goto(t.url, { waitUntil: 'networkidle', timeout: 90_000 });
      if (res && res.status() >= 400) continue;
      if (page.url().includes('/sign-in')) {
        throw new Error(`Screenshot landed on sign-in (${page.url()})`);
      }
      await settleDashboard(
        (sel, opts) => page.waitForSelector(sel, opts),
        (ms) => page.waitForTimeout(ms),
      );
      const empty = await pageLooksEmpty(() => page.innerText('body'));
      if (empty) {
        console.warn(`[screenshot] Empty UI for ${t.url} — trying next`);
        continue;
      }
      chosen = t;
      break;
    }
    if (!chosen) {
      const t = targets[targets.length - 1]!;
      await page.goto(t.url, { waitUntil: 'networkidle', timeout: 90_000 });
      await settleDashboard(
        (sel, opts) => page.waitForSelector(sel, opts),
        (ms) => page.waitForTimeout(ms),
      );
      chosen = t;
    }

    const png = Buffer.from(
      await page.screenshot({ fullPage: true, type: 'png', animations: 'disabled' }),
    );
    await context.close();
    return [shotFromPng(png, chosen.filename.replace(/-fallback/, ''), chosen.label)];
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * Capture live dashboard PNG(s). Uses puppeteer on Vercel; Playwright locally.
 * Prefers range=All and skips line filters; falls back to unfiltered overview if empty.
 */
export async function captureDashboardScreenshots(
  sub: ScreenshotSub,
  focus?: ScreenshotFocus,
): Promise<DashboardShot[]> {
  const targets = buildTargets(sub, focus);
  const shots = isServerless()
    ? await captureWithPuppeteer(targets)
    : await captureWithPlaywright(targets);
  if (!shots.length) throw new Error('No dashboard screenshots were captured');
  return shots;
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
