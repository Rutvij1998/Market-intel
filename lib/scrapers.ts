import axios from 'axios';
import * as cheerio from 'cheerio';
import { spawn } from 'child_process';
import path from 'path';
import { isElectronicDeviceProtection, detectCompany } from './utils';

export interface RawMention {
  id: string;
  text: string;
  source: string;
  url: string;
  created_at: string;
  subreddit?: string;
  title?: string;
  rating?: number | null;
  company?: string;
  author?: string;
}

// Polite scraping helpers (re-used)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const getRandomUserAgent = () => {
  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
  ];
  return agents[Math.floor(Math.random() * agents.length)];
};

async function fetchWithHeaders(url: string) {
  await delay(1100 + Math.random() * 1600);
  return axios.get(url, {
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://www.trustpilot.com/',
      'Sec-CH-UA': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"macOS"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Upgrade-Insecure-Requests': '1',
    },
    timeout: 25000,
    withCredentials: true,
  });
}

function parseDate(dateStr: string): string | null {
  if (!dateStr?.trim()) return null;
  try {
    const trimmed = dateStr.trim();
    const isoLike = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
    const d = new Date(isoLike);
    if (!isNaN(d.getTime())) return d.toISOString();
    const d2 = new Date(trimmed);
    if (!isNaN(d2.getTime())) return d2.toISOString();
  } catch {}
  return null;
}

// =====================================================
// Trustpilot scraper for Asurion, SquareTrade, Likewize (device protection focus)
// Strict electronic device protection filtering applied.
// =====================================================
export async function scrapeTrustpilot(limit = 60): Promise<RawMention[]> {
  const results: RawMention[] = [];
  // Target Asurion (primary competitor), Allstate, and SquareTrade for electronic device protection reviews.
  // Additional pages and keyword filter for phone/gadget/electronics protection.
  const targets = [
    { name: 'Asurion', url: 'https://www.trustpilot.com/review/asurion.com', companyHint: 'Asurion' },
    { name: 'SquareTrade', url: 'https://www.trustpilot.com/review/squaretrade.com', companyHint: 'SquareTrade' },
    { name: 'Allstate Protection', url: 'https://www.trustpilot.com/review/www.allstate.com', companyHint: 'Allstate' },
  ];

  for (const target of targets) {
    if (results.length >= limit) break;
    try {
      console.log(`[Scrapers][TP] Fetching ${target.name} ...`);
      const res = await fetchWithHeaders(target.url);
      const $ = cheerio.load(res.data);

      // Trustpilot review cards
      $('[data-review-id], article[class*="review"], div[class*="reviewCard"]').slice(0, 25).each((_, el) => {
        const text = $(el).find('p, [class*="reviewText"], [class*="content"]').first().text().trim() ||
                     $(el).text().trim();
        const ratingAttr = $(el).find('[class*="star"], [data-rating], [aria-label*="star"]').attr('aria-label') ||
                           $(el).find('img[alt*="star"]').attr('alt') || '';
        let rating: number | null = null;
        const m = ratingAttr.match(/(\d+(?:\.\d+)?)/);
        if (m) rating = parseFloat(m[1]);

        const dateEl = $(el).find('time, [class*="date"], [data-date]').first();
        const dateStr = dateEl.attr('datetime') || dateEl.text() || new Date().toISOString();

        const url = target.url;

        if (text.length > 40 && isElectronicDeviceProtection(text)) {
          const company = detectCompany(text) !== 'Other' ? detectCompany(text) : target.companyHint;
          results.push({
            id: `tp-${target.name.toLowerCase()}-${results.length}`,
            text: text.slice(0, 1400),
            source: 'Trustpilot',
            url,
            created_at: parseDate(dateStr) || new Date().toISOString(),
            title: `${target.name} review`,
            rating: rating || null,
            company,
          });
        }
      });

      // Try a couple pages
      for (let page = 2; page <= 4 && results.length < limit; page++) {
        await delay(1200);
        try {
          const pRes = await fetchWithHeaders(`${target.url}?page=${page}`);
          const $p = cheerio.load(pRes.data);
          $p('[data-review-id], article[class*="review"]').slice(0, 12).each((_, el) => {
            const text = $p(el).find('p, [class*="reviewText"]').first().text().trim();
            if (text.length > 40 && isElectronicDeviceProtection(text)) {
              const company = detectCompany(text) !== 'Other' ? detectCompany(text) : target.companyHint;
              results.push({
                id: `tp-${target.name.toLowerCase()}-p${page}-${results.length}`,
                text: text.slice(0, 1400),
                source: 'Trustpilot',
                url: `${target.url}?page=${page}`,
                created_at: new Date(Date.now() - Math.random()*10000000000).toISOString(),
                title: `${target.name} review`,
                rating: null,
                company,
              });
            }
          });
        } catch {}
      }
    } catch (e) {
      console.log(`[Scrapers][TP] ${target.name} failed: ${(e as any)?.message}`);
    }
  }

  console.log(`[Scrapers][TP] Collected ${results.length} device-protection reviews (Asurion/SquareTrade filtered).`);
  return results.slice(0, limit);
}

// =====================================================
// BBB scraper (basic) for Asurion + SquareTrade device protection
// =====================================================
export async function scrapeBBB(limit = 50): Promise<RawMention[]> {
  const results: RawMention[] = [];
  // BBB business profile review pages (approximate; real URLs can be found in BBB search)
  const targets = [
    { name: 'Asurion', url: 'https://www.bbb.org/us/tn/nashville/profile/warranty-contracts/asurion-llc-0573-37000000/customer-reviews', companyHint: 'Asurion' },
    { name: 'SquareTrade', url: 'https://www.bbb.org/us/ca/san-francisco/profile/warranty-contracts/squaretrade-1119-10000000/customer-reviews', companyHint: 'SquareTrade' },
    { name: 'Allstate Protection Plans', url: 'https://www.bbb.org/us/il/northbrook/profile/insurance/allstate-0215-90006763/customer-reviews', companyHint: 'Allstate' },
  ];

  for (const target of targets) {
    if (results.length >= limit) break;
    try {
      console.log(`[Scrapers][BBB] Fetching ${target.name}...`);
      const res = await fetchWithHeaders(target.url);
      const $ = cheerio.load(res.data);

      $('.review, .customer-review, [class*="review"]').slice(0, 20).each((_, el) => {
        const text = $(el).find('.review-text, .review-content, p').first().text().trim() || $(el).text().trim();
        const ratingText = $(el).find('.rating, [class*="star"]').text() || $(el).find('[aria-label]').attr('aria-label') || '';
        let rating: number | null = null;
        const m = ratingText.match(/(\d+(?:\.\d+)?)/);
        if (m) rating = parseFloat(m[1]);

        if (text.length > 35 && isElectronicDeviceProtection(text)) {
          const company = detectCompany(text) !== 'Other' ? detectCompany(text) : target.companyHint;
          results.push({
            id: `bbb-${target.name.toLowerCase()}-${results.length}`,
            text: text.slice(0, 1200),
            source: 'BBB',
            url: target.url,
            created_at: new Date(Date.now() - Math.random() * 8000000000).toISOString(),
            title: `${target.name} BBB review`,
            rating,
            company,
          });
        }
      });
    } catch (e) {
      console.log(`[Scrapers][BBB] ${target.name} error (common for BBB): ${(e as any)?.message?.slice(0,80)}`);
    }
  }

  console.log(`[Scrapers][BBB] Collected ${results.length} filtered device protection reviews.`);
  return results.slice(0, limit);
}

// =====================================================
// PissedConsumer scraper specifically for Likewize
// Site lists ~300+ reviews across many pages. Pagination
// uses /N/RT-P.html (and ?page=N), NOT only page 1.
// =====================================================
const PC_BASE = 'https://likewize.pissedconsumer.com';
const PC_REVIEW_LIST = `${PC_BASE}/review.html`;

function pissedConsumerPageUrl(page: number): string {
  if (page <= 1) return PC_REVIEW_LIST;
  // Canonical listing path used by the site for page 2+
  // (also accepts ?page=N; path form is more reliable with their CDN).
  return `${PC_BASE}/${page}/RT-P.html`;
}

function parsePissedConsumerReview($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>, pageUrl: string): RawMention | null {
  const blockText = $el.text().replace(/\s+/g, ' ').trim();
  const reviewId =
    $el.attr('data-review-id') ||
    $el.find('[data-review-id]').first().attr('data-review-id') ||
    blockText.match(/#(\d{6,})/)?.[1] ||
    null;
  if (!reviewId) return null;

  const title =
    $el.find('h2, .f-component-title, .review-item-title, a[href*="/complaint/"], a[href*="/review/"]').first().text().replace(/\s+/g, ' ').trim() ||
    'Likewize review';

  const dateRaw =
    $el.find('time').attr('datetime') ||
    $el.find('time').text().trim() ||
    blockText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/i)?.[0] ||
    '';
  const created_at = parseDate(dateRaw);
  if (!created_at) return null;

  const paragraphs = $el
    .find('p, .review_text_container, .f-component-text')
    .map((_, p) => $(p).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter((p) => p.length > 25 && !/share review|report review|thank you/i.test(p));
  // Prefer longest unique paragraph blob
  const body = [...new Set(paragraphs)].join('\n\n').trim();
  const text = body || title;
  if (text.length < 20) return null;

  const ratingText = $el.find('[class*="rating"], .stars, [aria-label*="star"]').text() || blockText;
  const ratingMatch = ratingText.match(/(\d+(?:\.\d+)?)\s*(?:out of 5)?/);
  const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

  const company = detectCompany(`${title} ${text}`) !== 'Other' ? detectCompany(`${title} ${text}`) : 'Likewize';

  return {
    id: `pc-${reviewId}`,
    text: text.slice(0, 1500),
    source: 'PissedConsumer',
    url: `${PC_REVIEW_LIST}#${reviewId}`,
    created_at,
    title: title.slice(0, 200),
    rating: rating && rating <= 5 ? rating : null,
    company,
  };
}

/**
 * Detect total page count from PissedConsumer pagination.
 * The old body-text regex matched "1" when ellipsis ("...") was present,
 * so only page 1 was ever scraped (~16–18 reviews instead of ~300).
 */
function detectPissedConsumerMaxPage($: cheerio.CheerioAPI): number {
  let maxPage = 1;

  // Primary: numbered page controls in .pagination (incl. last page / data-url)
  $('.pagination li, .pager li').each((_, el) => {
    const $el = $(el);
    const label = $el.text().replace(/\s+/g, ' ').trim();
    if (/^\d+$/.test(label)) {
      maxPage = Math.max(maxPage, parseInt(label, 10));
    }
    const dataUrl = $el.find('[data-url]').attr('data-url') || $el.attr('data-url') || '';
    const href = $el.find('a').attr('href') || '';
    for (const u of [dataUrl, href]) {
      const m =
        u.match(/\/(\d+)\/RT-P\.html/i) ||
        u.match(/[?&]page=(\d+)/i) ||
        u.match(/\/page\/(\d+)/i);
      if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
    }
  });

  // Secondary: any page= /N/RT-P links elsewhere on the page
  $('a[href*="page="], a[href*="/RT-P.html"], [data-url*="/RT-P.html"], [data-url*="page="]').each((_, el) => {
    const u = $(el).attr('href') || $(el).attr('data-url') || '';
    const m = u.match(/\/(\d+)\/RT-P\.html/i) || u.match(/[?&]page=(\d+)/i);
    if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
  });

  // Tertiary: title like "306 Likewize Reviews" → estimate pages (16/page)
  if (maxPage <= 1) {
    const title = $('title').text();
    const countMatch = title.match(/(\d+)\s+Likewize\s+Reviews/i);
    if (countMatch) {
      const total = parseInt(countMatch[1], 10);
      if (total > 0) maxPage = Math.max(maxPage, Math.ceil(total / 16));
    }
  }

  return Math.max(1, maxPage);
}

function countPissedConsumerItems($: cheerio.CheerioAPI): number {
  const snippet = $('.js-snippet-item, .f-component-item.review-item').length;
  if (snippet > 0) return snippet;
  return $('.review-item').length;
}

async function scrapePissedConsumerPage(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  byId: Map<string, RawMention>,
): Promise<number> {
  const before = byId.size;
  // Prefer real review cards; fall back to broader .review-item if layout changes
  const $cards = $('.js-snippet-item, .f-component-item.review-item');
  const $targets = $cards.length ? $cards : $('.review-item');
  $targets.each((_, el) => {
    const parsed = parsePissedConsumerReview($, $(el), pageUrl);
    if (parsed) byId.set(parsed.id, parsed);
  });
  return byId.size - before;
}

export async function scrapePissedConsumer(): Promise<RawMention[]> {
  const byId = new Map<string, RawMention>();
  let maxPage = 1;
  let consecutiveEmpty = 0;
  // Hard cap so a bad maxPage estimate cannot loop forever
  const HARD_CAP = 80;

  try {
    console.log(`[Scrapers][PC] Fetching Likewize PissedConsumer page 1 to detect pagination...`);
    const firstRes = await fetchWithHeaders(pissedConsumerPageUrl(1));
    const $first = cheerio.load(firstRes.data);
    maxPage = Math.min(HARD_CAP, detectPissedConsumerMaxPage($first));
    const added = await scrapePissedConsumerPage($first, pissedConsumerPageUrl(1), byId);
    console.log(`[Scrapers][PC] Page 1/${maxPage}: +${added} reviews (${byId.size} total)`);
  } catch (e) {
    console.log(`[Scrapers][PC] Page 1 failed: ${(e as any)?.message?.slice(0, 80)}`);
    return [];
  }

  for (let p = 2; p <= maxPage; p++) {
    const url = pissedConsumerPageUrl(p);
    try {
      const res = await fetchWithHeaders(url);
      const $ = cheerio.load(res.data);
      // Refresh maxPage if later pages expose a higher last-page number
      const detected = detectPissedConsumerMaxPage($);
      if (detected > maxPage && detected <= HARD_CAP) {
        console.log(`[Scrapers][PC] Extending pagination ${maxPage} → ${detected}`);
        maxPage = detected;
      }
      const itemCount = countPissedConsumerItems($);
      const added = await scrapePissedConsumerPage($, url, byId);
      console.log(`[Scrapers][PC] Page ${p}/${maxPage}: +${added} new from ${itemCount} items (${byId.size} total)`);

      if (itemCount === 0 || added === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 2) {
          console.log(`[Scrapers][PC] ${consecutiveEmpty} empty pages in a row, stopping pagination.`);
          break;
        }
      } else {
        consecutiveEmpty = 0;
      }
    } catch (e) {
      console.log(`[Scrapers][PC] Page ${p} failed: ${(e as any)?.message?.slice(0, 80)}`);
      consecutiveEmpty++;
      if (consecutiveEmpty >= 3) break;
    }
    await delay(1200);
  }

  const results = Array.from(byId.values());
  console.log(`[Scrapers][PC] Collected ${results.length} unique Likewize reviews across up to ${maxPage} PissedConsumer page(s).`);
  return results;
}

// =====================================================
// BBB scrapers (Likewize + Asurion) — all customer-review pages
// Cloudflare-protected; scraping via Python cloudscraper (scripts/scrape_bbb.py).
// =====================================================
function scrapeBBBCompany(
  company: 'Likewize' | 'Asurion',
  maxPages: number,
): Promise<RawMention[]> {
  const scriptPath = path.join(process.cwd(), 'scripts', 'scrape_bbb.py');
  console.log(
    `[Scrapers][BBB] Starting ${company} BBB scrape (up to ${maxPages} pages via cloudscraper)...`,
  );

  return new Promise((resolve) => {
    const child = spawn(
      'python3',
      [scriptPath, '--company', company, '--max-pages', String(maxPages), '--delay', '1.0'],
      { cwd: process.cwd(), env: process.env },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      const line = d.toString();
      stderr += line;
      for (const l of line.split('\n')) {
        if (l.trim()) console.log(l.trim());
      }
    });

    child.on('error', (err) => {
      console.log(`[Scrapers][BBB] Failed to start python: ${err.message}`);
      resolve([]);
    });

    child.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        console.log(`[Scrapers][BBB] Script exited ${code}. ${stderr.slice(0, 300)}`);
        resolve([]);
        return;
      }
      try {
        const jsonStart = stdout.indexOf('{');
        if (jsonStart < 0) {
          console.log(`[Scrapers][BBB] No JSON in output for ${company}`);
          resolve([]);
          return;
        }
        const payload = JSON.parse(stdout.slice(jsonStart));
        if (payload.error) {
          console.log(`[Scrapers][BBB] Error (${company}): ${payload.error}`);
        }
        const reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
        const results: RawMention[] = reviews.map((r: any) => ({
          id: String(r.id || `bbb-${Math.random().toString(36).slice(2)}`),
          text: String(r.text || '').slice(0, 1500),
          source: 'BBB',
          url: String(r.url || 'https://www.bbb.org/'),
          created_at: r.created_at || new Date().toISOString(),
          title: String(r.title || `${company} BBB review`).slice(0, 200),
          rating: typeof r.rating === 'number' ? r.rating : null,
          company: (r.company === 'Asurion' || company === 'Asurion' ? 'Asurion' : 'Likewize') as string,
          author: r.author,
        }));
        console.log(
          `[Scrapers][BBB] Collected ${results.length} unique ${company} BBB reviews ` +
            `(pages=${payload.pages || '?'}, max_detected=${payload.max_page_detected || '?'}).`,
        );
        resolve(results);
      } catch (e: any) {
        console.log(
          `[Scrapers][BBB] Parse failed (${company}): ${e?.message}. stdout head: ${stdout.slice(0, 200)}`,
        );
        resolve([]);
      }
    });
  });
}

export async function scrapeLikewizeBBB(maxPages = 80): Promise<RawMention[]> {
  return scrapeBBBCompany('Likewize', maxPages);
}

/** Asurion BBB reviews — competitor analysis only (not Overview). */
export async function scrapeAsurionBBB(maxPages = 1000): Promise<RawMention[]> {
  return scrapeBBBCompany('Asurion', maxPages);
}
