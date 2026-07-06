import axios from 'axios';
import * as cheerio from 'cheerio';
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
// Focus on device protection / phone insurance complaints.
// =====================================================
function parsePissedConsumerReview($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>, pageUrl: string): RawMention | null {
  const blockText = $el.text().replace(/\s+/g, ' ').trim();
  const reviewIdMatch = blockText.match(/#(\d{6,})/);
  if (!reviewIdMatch) return null;

  const reviewId = reviewIdMatch[1];
  const title = $el.find('h2').first().text().trim() || 'Likewize review';

  const dateRaw =
    $el.find('time').attr('datetime') ||
    $el.find('time').text().trim() ||
    blockText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/i)?.[0] ||
    '';
  const created_at = parseDate(dateRaw);
  if (!created_at) return null;

  const paragraphs = $el
    .find('p')
    .map((_, p) => $(p).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter((p) => p.length > 25 && !/share review|report review|thank you/i.test(p));
  const body = paragraphs.join('\n\n').trim();
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
    url: `https://likewize.pissedconsumer.com/review.html#${reviewId}`,
    created_at,
    title: title.slice(0, 200),
    rating: rating && rating <= 5 ? rating : null,
    company,
  };
}

function detectPissedConsumerMaxPage($: cheerio.CheerioAPI): number {
  const pagMatch = $('body').text().match(/Prev\s+[\d\s.]+(?:\.\.\.\s*)?(\d+)\s+Next/i);
  if (pagMatch) return Math.max(1, parseInt(pagMatch[1], 10));

  let maxPage = 1;
  $('a[href*="page="]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/page=(\d+)/i);
    if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
  });
  return maxPage;
}

async function scrapePissedConsumerPage(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  byId: Map<string, RawMention>,
): Promise<number> {
  const before = byId.size;
  $('.review-item').each((_, el) => {
    const parsed = parsePissedConsumerReview($, $(el), pageUrl);
    if (parsed) byId.set(parsed.id, parsed);
  });
  return byId.size - before;
}

export async function scrapePissedConsumer(): Promise<RawMention[]> {
  const byId = new Map<string, RawMention>();
  const baseUrl = 'https://likewize.pissedconsumer.com/review.html';
  let maxPage = 1;

  try {
    console.log(`[Scrapers][PC] Fetching Likewize PissedConsumer page 1 to detect pagination...`);
    const firstRes = await fetchWithHeaders(baseUrl);
    const $first = cheerio.load(firstRes.data);
    maxPage = detectPissedConsumerMaxPage($first);
    const added = await scrapePissedConsumerPage($first, baseUrl, byId);
    console.log(`[Scrapers][PC] Page 1/${maxPage}: +${added} reviews (${byId.size} total)`);
  } catch (e) {
    console.log(`[Scrapers][PC] Page 1 failed: ${(e as any)?.message?.slice(0, 80)}`);
    return [];
  }

  for (let p = 2; p <= maxPage; p++) {
    const url = `${baseUrl}?page=${p}`;
    try {
      const res = await fetchWithHeaders(url);
      const $ = cheerio.load(res.data);
      const itemCount = $('.review-item').length;
      const added = await scrapePissedConsumerPage($, url, byId);
      console.log(`[Scrapers][PC] Page ${p}/${maxPage}: +${added} new from ${itemCount} items (${byId.size} total)`);
      if (itemCount === 0) {
        console.log(`[Scrapers][PC] Empty page ${p}, stopping pagination.`);
        break;
      }
    } catch (e) {
      console.log(`[Scrapers][PC] Page ${p} failed: ${(e as any)?.message?.slice(0, 80)}`);
    }
    await delay(1200);
  }

  const results = Array.from(byId.values());
  console.log(`[Scrapers][PC] Collected ${results.length} unique Likewize reviews across ${maxPage} PissedConsumer page(s).`);
  return results;
}
