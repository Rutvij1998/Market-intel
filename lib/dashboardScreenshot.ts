/**
 * Capture screenshots / full-page PDFs of the live Market Vantage dashboard.
 *
 * Local: Playwright
 * Vercel: puppeteer-core + @sparticuz/chromium
 *
 * Modes:
 * - Auto alerts: range=All, skip line filters, fall back if empty
 * - Exact snapshot: recreate the filters the user had open (tab/range/client/line/source)
 *   and capture the full page for PNG + multi-page PDF
 */

import { dashboardCredentials } from '@/lib/sessionAuth';

export interface ScreenshotSub {
  all_clients: boolean;
  clients: string[];
  all_business_lines: boolean;
  business_lines: string[];
}

/** Live UI state when the user clicks “Send email now”. */
export interface DashboardViewSnapshot {
  tab: 'overview' | 'competitor';
  range: '7d' | '30d' | '90d' | 'All';
  client: string; // "All" or name
  source: string; // "All" or source label
  businessLine: string; // "All" or BusinessLine code
}

export interface ScreenshotFocus {
  client?: string;
  line?: string;
  source?: string;
  tab?: 'overview' | 'competitor';
  range?: '7d' | '30d' | '90d' | 'All';
  eventOnly?: boolean;
  /** When true (default for auto alerts), skip business-line filter */
  skipLineFilter?: boolean;
  /**
   * Exact user view: honor range/client/line/source/tab as given (even 7d).
   * full-page capture for PDF.
   */
  exactSnapshot?: boolean;
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
  const exact = !!focus?.exactSnapshot;
  const effectiveTab = focus?.tab || tab || 'overview';
  if (effectiveTab === 'competitor') u.searchParams.set('tab', 'competitor');

  if (exact) {
    if (focus?.client && focus.client !== 'All') u.searchParams.set('client', focus.client);
    if (focus?.line && focus.line !== 'All') u.searchParams.set('line', focus.line);
    if (focus?.source && focus.source !== 'All') u.searchParams.set('source', focus.source);
    u.searchParams.set('range', focus?.range || 'All');
    u.searchParams.set('exact', '1');
  } else {
    const client =
      focus?.client ||
      (!sub.all_clients && sub.clients?.length === 1 ? sub.clients[0] : undefined);
    if (client && client !== 'All') u.searchParams.set('client', client);

    const skipLine = focus?.skipLineFilter !== false;
    if (!skipLine) {
      const line =
        focus?.line ||
        (!sub.all_business_lines && sub.business_lines?.length === 1
          ? sub.business_lines[0]
          : undefined);
      if (line && line !== 'All') u.searchParams.set('line', line);
    }

    // Auto alerts: avoid empty 7d when ingest is stale
    const range = focus?.range && focus.range !== '7d' ? focus.range : 'All';
    u.searchParams.set('range', range);
  }

  u.searchParams.set('screenshot', '1');
  return u.toString();
}

/** Build focus from the live dashboard controls the user had open. */
export function focusFromViewSnapshot(snap: DashboardViewSnapshot): ScreenshotFocus {
  return {
    tab: snap.tab,
    range: snap.range,
    client: snap.client !== 'All' ? snap.client : undefined,
    line: snap.businessLine !== 'All' ? snap.businessLine : undefined,
    source: snap.source !== 'All' ? snap.source : undefined,
    exactSnapshot: true,
    eventOnly: false,
    skipLineFilter: false,
  };
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

async function pageLooksEmpty(getText: () => Promise<string>): Promise<boolean> {
  const text = await getText();
  if (/No real data yet/i.test(text)) return true;
  if (/No data in current filter/i.test(text)) return true;
  if (/LIKEWIZE MENTIONS\s*0\b/i.test(text) && /POSITIVE SENTIMENT\s*0%/i.test(text)) {
    return true;
  }
  return false;
}

type Target = { url: string; filename: string; label: string };

function buildTargets(sub: ScreenshotSub, focus?: ScreenshotFocus): Target[] {
  // Exact snapshot of what the user had open — single URL, no fallback that changes filters
  if (focus?.exactSnapshot) {
    const parts = [
      focus.tab || 'overview',
      focus.range || 'All',
      focus.client || 'all-clients',
      focus.line || 'all-lines',
    ];
    const safe = parts.join('-').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60);
    return [
      {
        url: dashboardUrlForSubscription(sub, focus.tab || 'overview', focus),
        filename: `market-vantage-snapshot-${safe}.png`,
        label: `Live snapshot · ${focus.tab || 'overview'} · ${focus.range || 'All'}${
          focus.client ? ` · ${focus.client}` : ''
        }${focus.line ? ` · ${focus.line}` : ''}`,
      },
    ];
  }

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

/**
 * Wait for dashboard + ALL Recharts (pies + bars) to paint.
 * ResponsiveContainer often measures 0×0 until resize; bar animations also leave empty axes.
 */
async function settleDashboard(page: {
  waitForSelector: (sel: string, opts: { timeout: number }) => Promise<unknown>;
  evaluate: (fn: () => unknown) => Promise<unknown>;
  waitForFunction?: (
    fn: () => boolean,
    opts?: { timeout?: number },
  ) => Promise<unknown>;
}) {
  try {
    await page.waitForSelector('[data-dashboard-ready="true"]', { timeout: 45_000 });
  } catch {
    await page.waitForSelector('.mv-app-shell', { timeout: 20_000 });
  }

  // Scroll every chart container into view and force remeasure
  const nudgeCharts = async () => {
    await page.evaluate(() => {
      const nodes = document.querySelectorAll(
        '.mv-pie-chart, .mv-pie-panel, .recharts-wrapper, [data-chart-ready], [data-chart]',
      );
      nodes.forEach((el) => {
        try {
          (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'nearest' });
        } catch {
          /* ignore */
        }
      });
      window.dispatchEvent(new Event('resize'));
      // Recharts uses ResizeObserver — toggling width slightly can help stubborn cases
      document.querySelectorAll('.recharts-responsive-container').forEach((el) => {
        const h = el as HTMLElement;
        const prev = h.style.width;
        h.style.width = '99.5%';
        void h.offsetWidth;
        h.style.width = prev || '100%';
      });
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    });
  };

  await nudgeCharts();
  await new Promise((r) => setTimeout(r, isServerless() ? 2800 : 2200));
  await nudgeCharts();
  await new Promise((r) => setTimeout(r, 1200));

  // Wait for any painted chart geometry (pie sectors OR bar rectangles with real size)
  try {
    if (page.waitForFunction) {
      await page.waitForFunction(
        () => {
          const wrappers = document.querySelectorAll('.recharts-wrapper, .recharts-surface');
          if (!wrappers.length) return true;

          const pick = (sel: string) =>
            Array.from(document.querySelectorAll(sel)).some((el) => {
              const b = (el as Element).getBoundingClientRect();
              return b.width > 2 && b.height > 2;
            });

          const hasPie = pick(
            '.recharts-sector, .recharts-pie-sector, path.recharts-sector',
          );
          const hasBar = pick(
            '.recharts-bar-rectangle, .recharts-rectangle:not(.recharts-tooltip-cursor)',
          );
          // Axes-only empty charts: wrapper exists but no geometry — keep waiting if totals imply data
          const body = document.body.innerText || '';
          const expectsCharts =
            /Mentions by business line|Mentions by source|Breakdown by retailer|Comparative performance/i.test(
              body,
            ) && !/No real data yet|No business-line data|No source data|No retailer-specific data/i.test(body);

          if (!expectsCharts) return true;
          return hasPie || hasBar;
        },
        { timeout: 25_000 },
      );
    }
  } catch {
    console.warn('[screenshot] Chart geometry not detected in time — capturing anyway');
  }

  // One more resize + paint settle, then top for full-page shot
  await nudgeCharts();
  await new Promise((r) => setTimeout(r, isServerless() ? 2000 : 1500));
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await new Promise((r) => setTimeout(r, 500));
}

/** Puppeteer + @sparticuz/chromium — Vercel/Lambda. Always fullPage for PDF. */
async function captureWithPuppeteer(
  targets: Target[],
  opts: { exact: boolean },
): Promise<DashboardShot[]> {
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
      await settleDashboard(page);

      if (!opts.exact) {
        const empty = await pageLooksEmpty(() => page.evaluate(() => document.body.innerText));
        if (empty) {
          console.warn(`[screenshot] Empty UI for ${t.url} — trying next URL`);
          continue;
        }
      }
      chosen = t;
      break;
    }

    if (!chosen) {
      const t = targets[targets.length - 1]!;
      console.warn(`[screenshot] Using last target ${t.url}`);
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 50_000 });
      await settleDashboard(page);
      chosen = t;
    }

    // Full page for PDF (entire scrollable dashboard)
    const png = Buffer.from(
      await page.screenshot({ type: 'png', fullPage: true }),
    );
    return [shotFromPng(png, chosen.filename.replace(/-fallback/, ''), chosen.label)];
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function captureWithPlaywright(
  targets: Target[],
  opts: { exact: boolean },
): Promise<DashboardShot[]> {
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
      const res = await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      if (res && res.status() >= 400) continue;
      if (page.url().includes('/sign-in')) {
        throw new Error(`Screenshot landed on sign-in (${page.url()})`);
      }
      await settleDashboard(page);
      if (!opts.exact) {
        const empty = await pageLooksEmpty(() => page.innerText('body'));
        if (empty) {
          console.warn(`[screenshot] Empty UI for ${t.url} — trying next`);
          continue;
        }
      }
      chosen = t;
      break;
    }
    if (!chosen) {
      const t = targets[targets.length - 1]!;
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await settleDashboard(page);
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

export async function captureDashboardScreenshots(
  sub: ScreenshotSub,
  focus?: ScreenshotFocus,
): Promise<DashboardShot[]> {
  const targets = buildTargets(sub, focus);
  const exact = !!focus?.exactSnapshot;
  const shots = isServerless()
    ? await captureWithPuppeteer(targets, { exact })
    : await captureWithPlaywright(targets, { exact });
  if (!shots.length) throw new Error('No dashboard screenshots were captured');
  return shots;
}

/**
 * Embed full-page screenshot(s) into a multi-page PDF (whole page, sliced vertically).
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
      // Fit to letter width; slice tall full-page captures across multiple PDF pages
      const maxPageW = 612; // letter width points
      const maxPageH = 792; // letter height
      const scale = Math.min(1, maxPageW / shot.width);
      const scaledW = shot.width * scale;
      const scaledH = shot.height * scale;

      if (scaledH <= maxPageH) {
        doc.addPage({ size: [scaledW, Math.max(scaledH, 200)], margin: 0 });
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
