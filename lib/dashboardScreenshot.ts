/**
 * Capture screenshots of the live Market Vantage dashboard URL.
 *
 * Local: Playwright (full install)
 * Vercel/serverless: puppeteer-core + @sparticuz/chromium
 *   (Playwright browsers.json is NOT available under /var/task)
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

/** Puppeteer + @sparticuz/chromium — works on Vercel/Lambda. */
async function captureWithPuppeteer(
  targets: { url: string; filename: string; label: string }[],
): Promise<DashboardShot[]> {
  const chromium = (await import('@sparticuz/chromium')).default;
  const puppeteer = (await import('puppeteer-core')).default;

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
    const base = appBaseUrl();
    const { username, password } = dashboardCredentials();

    // Login via HTTP API (sets cookies on the browser context)
    const loginRes = await page.evaluate(
      async (opts: { url: string; username: string; password: string }) => {
        const res = await fetch(opts.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: opts.username, password: opts.password }),
          credentials: 'include',
        });
        return { ok: res.ok, status: res.status, text: await res.text() };
      },
      { url: `${base}/api/auth/login`, username, password },
    );

    // page.evaluate fetch may not store Set-Cookie into the browser jar on all runtimes.
    // Prefer setCookie from a real Node-side login.
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

    const host = new URL(base).hostname;
    for (const raw of rawCookies) {
      const [pair] = raw.split(';');
      const eq = pair?.indexOf('=') ?? -1;
      if (eq < 0) continue;
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      if (!name) continue;
      await page.setCookie({
        name,
        value,
        domain: host,
        path: '/',
        httpOnly: true,
        secure: base.startsWith('https'),
        sameSite: 'Lax',
      });
    }
    void loginRes; // evaluated login is best-effort; cookie jar from nodeLogin is authoritative

    const shots: DashboardShot[] = [];
    for (const t of targets) {
      console.log(`[screenshot] Opening ${t.url}`);
      const res = await page.goto(t.url, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      if (res && res.status() >= 400) {
        throw new Error(`Dashboard returned HTTP ${res.status()} for ${t.url}`);
      }
      if (page.url().includes('/sign-in')) {
        throw new Error(`Screenshot landed on sign-in (${page.url()})`);
      }
      try {
        await page.waitForSelector('[data-dashboard-ready="true"]', { timeout: 40_000 });
      } catch {
        await page.waitForSelector('.mv-app-shell', { timeout: 15_000 });
      }
      await new Promise((r) => setTimeout(r, 2000));
      const png = Buffer.from(await page.screenshot({ type: 'png', fullPage: false }));
      shots.push(shotFromPng(png, t.filename, t.label));
    }
    return shots;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** Full Playwright — local/dev only (never import on Vercel). */
async function captureWithPlaywright(
  targets: { url: string; filename: string; label: string }[],
): Promise<DashboardShot[]> {
  // Dynamic import keeps this out of the serverless graph when isServerless() is true
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

    const shots: DashboardShot[] = [];
    for (const t of targets) {
      console.log(`[screenshot] Opening ${t.url}`);
      const res = await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      if (res && res.status() >= 400) {
        throw new Error(`Dashboard returned HTTP ${res.status()} for ${t.url}`);
      }
      if (page.url().includes('/sign-in')) {
        throw new Error(`Screenshot landed on sign-in (${page.url()})`);
      }
      try {
        await page.waitForSelector('[data-dashboard-ready="true"]', { timeout: 60_000 });
      } catch {
        await page.waitForSelector('.mv-app-shell', { timeout: 30_000 });
      }
      await page.waitForTimeout(3000);
      const png = Buffer.from(
        await page.screenshot({ fullPage: true, type: 'png', animations: 'disabled' }),
      );
      shots.push(shotFromPng(png, t.filename, t.label));
    }
    await context.close();
    return shots;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function buildTargets(sub: ScreenshotSub, focus?: ScreenshotFocus) {
  const eventOnly = focus?.eventOnly !== false && !!focus?.client;
  if (eventOnly) {
    const tab = focus?.tab || 'overview';
    const labelClient = focus?.client || 'event';
    const safe = labelClient.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 40);
    return [
      {
        url: dashboardUrlForSubscription(sub, tab, focus),
        filename: `market-vantage-${safe}.png`,
        label: `Dashboard · ${labelClient}${focus?.line ? ` · ${focus.line}` : ''}`,
      },
    ];
  }
  const list = [
    {
      url: dashboardUrlForSubscription(sub, 'overview', focus),
      filename: 'market-vantage-overview.png',
      label: 'Dashboard · Overview',
    },
  ];
  if (!isServerless()) {
    list.push({
      url: dashboardUrlForSubscription(sub, 'competitor', focus),
      filename: 'market-vantage-competitor.png',
      label: 'Dashboard · Competitor Analysis',
    });
  }
  return list;
}

/**
 * Capture live dashboard PNG(s). Uses puppeteer on Vercel; Playwright locally.
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
