import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

// =====================================================
// ELECTRONIC DEVICE PROTECTION FILTERING (Strict)
// Only phones, gadgets, electronics, screen protection, extended warranties for devices.
// =====================================================

const POSITIVE_DEVICE_KEYWORDS = [
  'phone protection', 'device protection', 'gadget protection', 'phone insurance',
  'device insurance', 'protection plan', 'extended warranty phone', 'phone warranty',
  'screen protection', 'screen protector plan', 'accidental damage protection',
  'phone replacement plan', 'gadget warranty', 'electronics protection', 'tech protection',
  'device care', 'phone care plan', 'smartphone protection', 'tablet protection',
  'laptop protection plan', 'computer warranty electronics'
];

const NEGATIVE_EXCLUSIONS = [
  'health insurance', 'medical insurance', 'dental', 'vision insurance', 'life insurance',
  'auto insurance', 'car insurance', 'vehicle protection', 'auto warranty', 'car warranty',
  'roadside assistance', 'home insurance', 'homeowners', 'renters insurance',
  'property insurance', 'home warranty', 'house insurance', 'appliance repair home',
  'pet insurance', 'dog insurance', 'cat insurance', 'pet protection plan',
  'travel insurance', 'trip protection', 'flight insurance', 'vacation protection',
  'medical alert', 'health plan', 'car protection plan'
];

export function isElectronicDeviceProtection(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();

  // Hard exclude non-device categories
  for (const neg of NEGATIVE_EXCLUSIONS) {
    if (lower.includes(neg)) return false;
  }

  // Must have device/electronics context + protection language
  const hasDevice = /(phone|smartphone|iphone|android|samsung|tablet|ipad|laptop|computer|macbook|gadget|electronics|screen|device|tech|headphones|watch|console)/i.test(lower);
  const hasProtectionLang = /(protection|warranty|insurance|plan|care|extended|accidental damage|replacement|claim|deductible|repair|screen replacement)/i.test(lower);

  // Company names help
  const hasCompany = /(likewize|like wize|asurion|squaretrade|square trade|allstate protection)/i.test(lower);

  // Positive keyword match
  const hasPositiveKeyword = POSITIVE_DEVICE_KEYWORDS.some(kw => lower.includes(kw));

  if (hasCompany && (hasDevice || hasProtectionLang)) return true;
  if (hasPositiveKeyword && hasDevice && hasProtectionLang) return true;
  if (hasDevice && hasProtectionLang && (hasCompany || hasPositiveKeyword)) return true;

  // Fallback: strong protection + device mention without obvious negatives (already filtered)
  return hasDevice && hasProtectionLang && hasPositiveKeyword;
}

type MentionSourceHints = { url?: string; id?: string };

/** Normalize scraper/UI source labels to consistent lowercase DB values. */
export function normalizeMentionSource(source?: string, hints?: MentionSourceHints): string {
  const url = (hints?.url || '').toLowerCase();
  if (url.includes('pissedconsumer.com')) return 'pissedconsumer';
  if (url.includes('trustpilot.com')) return 'trustpilot';
  if (url.includes('bbb.org')) return 'bbb';
  if (url.includes('reddit.com')) return 'reddit';

  const id = hints?.id || '';
  if (id.startsWith('pc-')) return 'pissedconsumer';
  if (id.startsWith('tp-')) return 'trustpilot';
  if (id.startsWith('bbb-')) return 'bbb';
  if (id.startsWith('reddit-')) return 'reddit';

  const s = (source || '').toLowerCase().trim();
  if (s.includes('trustpilot')) return 'trustpilot';
  if (s.includes('bbb')) return 'bbb';
  if (s.includes('pissedconsumer') || s.includes('pissed consumer') || s.includes('pissed')) return 'pissedconsumer';
  if (s.includes('reddit')) return 'reddit';
  if (s.includes('app store') || s.includes('appstore')) return 'appstore';
  return s || 'reddit';
}

export function mentionDedupKey(m: { id?: string; text?: string; url?: string }): string {
  const id = m.id || '';
  const pcMatch = id.match(/^pc-(\d{6,})$/);
  if (pcMatch) return `pc:${pcMatch[1]}`;
  const bbbMatch = id.match(/^bbb-(.+)$/);
  if (bbbMatch) return `bbb:${bbbMatch[1]}`;
  const redditMatch = id.match(/^reddit-(.+)$/);
  if (redditMatch) return `reddit:${redditMatch[1]}`;
  const textKey = (m.text || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 160);
  if (textKey.length > 40) return `text:${textKey}`;
  return `id:${id || m.url || ''}`;
}

function mentionQualityScore(m: { id?: string; created_at?: string }): number {
  let score = 0;
  if (/^pc-\d{6,}$/.test(m.id || '')) score += 10;
  if (/^pc-likewize-/.test(m.id || '')) score -= 5;
  const ts = new Date(m.created_at || 0).getTime();
  if (ts > 0 && ts < Date.now() - 48 * 60 * 60 * 1000) score += 5;
  return score;
}

export function dedupeMentions<T extends { id?: string; text?: string; url?: string; created_at?: string }>(mentions: T[]): T[] {
  const seen = new Map<string, T>();
  for (const m of mentions) {
    const key = mentionDedupKey(m);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, m);
      continue;
    }
    seen.set(key, mentionQualityScore(m) > mentionQualityScore(existing) ? m : existing);
  }
  return Array.from(seen.values());
}

export function formatMentionTimeAgo(createdAt: string): string {
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return 'Unknown date';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function isDashboardSource(source?: string): boolean {
  const s = (source || '').toLowerCase();
  return (
    s.includes('reddit') ||
    s.includes('pissedconsumer') ||
    s.includes('pissed') ||
    s.includes('bbb')
  );
}

export function formatMentionSourceLabel(source?: string): string {
  const s = (source || '').toLowerCase();
  if (s.includes('reddit')) return 'Reddit';
  if (s.includes('trustpilot')) return 'Trustpilot';
  if (s.includes('pissedconsumer') || s.includes('pissed')) return 'PissedConsumer';
  if (s.includes('bbb')) return 'BBB';
  if (s.includes('app store') || s.includes('appstore')) return 'App Store';
  return source || 'Source';
}

export function detectCompany(text: string): 'Likewize' | 'Asurion' | 'Allstate' | 'SquareTrade' | 'Other' {
  const lower = (text || '').toLowerCase();
  if (lower.includes('likewize') || lower.includes('like wize') || lower.includes('like-wize')) return 'Likewize';
  if (lower.includes('asurion')) return 'Asurion';
  if (lower.includes('allstate') || lower.includes('all state')) return 'Allstate';
  if (lower.includes('squaretrade') || lower.includes('square trade')) return 'SquareTrade';
  return 'Other';
}

/** True if text clearly mentions Asurion (competitor — keep all Reddit mentions, not just device protection). */
export function mentionsAsurion(text?: string | null): boolean {
  return /\basurion\b/i.test(text || '');
}

/**
 * Normalize retailer / carrier / partner labels so filters group cleanly
 * (e.g. "rogers", "r/Rogers", "Rogers Wireless" → "Rogers").
 */
export function normalizeClientLabel(raw?: string | null): string {
  const s = (raw || '').trim();
  if (!s) return 'Unassigned';

  // strip leading r/ from subreddit-style values
  const lower = s.replace(/^r\//i, '').toLowerCase().replace(/[_-]+/g, ' ').trim();

  if (/newegg/.test(lower)) return 'Newegg';
  if (/best\s*buy|bestbuy/.test(lower)) return 'Best Buy';
  if (/samsung|galaxy/.test(lower)) return 'Samsung';
  if (/^apple$|iphone|ipad/.test(lower)) return 'Apple';
  if (/target/.test(lower)) return 'Target';
  if (/walmart/.test(lower)) return 'Walmart';
  if (/verizon/.test(lower)) return 'Verizon';
  // Word-bound T-Mobile so "boost mobile" is not misread as T-Mobile
  if (/\bt[\s-]*mobile\b|\btmobile\b/.test(lower)) return 'T-Mobile';
  if (/at\s*[&]?\s*t|^att$/.test(lower)) return 'AT&T';
  if (/\bboost(\s*mobile)?\b|boostmobile/.test(lower)) return 'Boost Mobile';
  if (/oneplus/.test(lower)) return 'OnePlus';
  if (/rogers/.test(lower)) return 'Rogers';
  if (/^bell$|bell canada|bellmobility/.test(lower)) return 'Bell';
  if (/telus/.test(lower)) return 'Telus';
  if (/shaw/.test(lower)) return 'Shaw';
  if (/fido/.test(lower)) return 'Fido';
  if (/koodo/.test(lower)) return 'Koodo';
  if (/freedom/.test(lower)) return 'Freedom Mobile';
  if (/costco/.test(lower)) return 'Costco';
  if (/sam'?s\s*club|samsclub/.test(lower)) return "Sam's Club";
  if (/cricket/.test(lower)) return 'Cricket Wireless';
  if (/straight\s*talk|straighttalk/.test(lower)) return 'Straight Talk';
  if (/pissed/.test(lower)) return 'PissedConsumer (Direct)';
  if (/other\/direct|other|direct|unassigned|unknown|n\/a|none/.test(lower)) return 'Unassigned';

  // Title-case leftover labels (subreddits etc.)
  if (s.length <= 40 && !/\s{2,}/.test(s)) {
    return s
      .replace(/^r\//i, '')
      .split(/[\s_]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }
  return s.slice(0, 40);
}

/** Resolve the client / account key for a mention (retailer, carrier, partner). */
export function getMentionClient(m: {
  client?: string | null;
  retailer_context?: string | null;
  subreddit?: string | null;
  source?: string | null;
  id?: string | null;
  company?: string | null;
  [key: string]: any;
}): string {
  const src = (m.source || '').toLowerCase();
  const id = String(m.id || (m as any).reddit_id || '').toLowerCase();
  const company = String(m.company || '').toLowerCase();

  // BBB profile reviews have no retailer channel — brand is the company, not Unassigned
  if (src.includes('bbb') || id.startsWith('bbb-')) {
    if (company === 'asurion' || id.includes('2131781') || id.includes('0573_2131781')) return 'Asurion';
    return 'Likewize';
  }

  const raw =
    m.client ||
    m.retailer_context ||
    (m as any).retailer ||
    m.subreddit ||
    '';
  if (raw) {
    const label = normalizeClientLabel(String(raw));
    // Don't surface "Unassigned" as a top retailer for Likewize-owned sources
    if (label === 'Unassigned') {
      if (src.includes('pissed') || src.includes('bbb')) return 'Likewize';
      if (String(m.company || '').toLowerCase() === 'likewize') return 'Likewize';
    }
    return label;
  }

  if (src.includes('pissed')) return 'Likewize';
  if (String(m.company || '').toLowerCase() === 'likewize') return 'Likewize';
  return 'Unassigned';
}

// =====================================================
// LIKEWIZE BUSINESS LINES (Overview only — never competitors)
// DP | HomeTech | TradeIn | Shipping | CallCenter | Other
// =====================================================

export const BusinessLines = ['DP', 'HomeTech', 'TradeIn', 'Shipping', 'CallCenter', 'Other'] as const;
export type BusinessLine = (typeof BusinessLines)[number];

export const BUSINESS_LINE_LABELS: Record<BusinessLine, string> = {
  DP: 'DP',
  HomeTech: 'HomeTech',
  TradeIn: 'Trade-In',
  Shipping: 'Shipping',
  CallCenter: 'Call Center',
  Other: 'Other',
};

/** Clients that always map to a fixed product business line (Likewize). */
const CLIENT_BUSINESS_LINE_RULES: Array<{ match: RegExp; line: BusinessLine }> = [
  // Always Device Protection (carrier phone plans)
  { match: /boost\s*mobile|boostmobile/i, line: 'DP' },
  { match: /^rogers$|rogers\s/i, line: 'DP' },
  { match: /^fido$|fido\s/i, line: 'DP' },
  // Always HomeTech (retail electronics / appliance channel)
  { match: /newegg/i, line: 'HomeTech' },
];

/**
 * Infer Likewize business line from issue + client + device context.
 * Issue lines (Shipping / Call Center) win when clearly about that problem;
 * then client hard-rules; then Trade-In / HomeTech / DP; else Other.
 */
export function detectBusinessLine(m: {
  client?: string | null;
  retailer_context?: string | null;
  subreddit?: string | null;
  source?: string | null;
  text?: string | null;
  title?: string | null;
  full_thread?: string | null;
  content?: string | null;
  [key: string]: any;
}): BusinessLine {
  const client = getMentionClient(m);

  const hay = [
    m.text,
    m.title,
    m.full_thread,
    m.content,
    client,
    m.subreddit,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  // --- Issue-based lines (strong operational signals) ---
  // Shipping: delayed/lost packages, tracking, not delivered, courier, etc.
  if (
    /\bship(?:ping|ped|ment)?\b|\bnot\s+deliver(?:ed|y)\b|\bnever\s+(arrived|received|showed)\b|\bstill\s+(waiting|haven'?t\s+received)\b.*\b(package|parcel|device|phone|box)\b|\bpackage\s+(lost|missing|delayed|stuck)\b|\btracking\s+(number|info|said|shows)?\b|\bcourier\b|\bfedex\b|\bups\b|\busps\b|\bdhl\b|\bin\s+transit\b|\bout\s+for\s+delivery\b|\breturn\s+to\s+sender\b|\bwrong\s+address\b|\bdelivery\s+(delay|issue|problem|failed)\b|\bhasn'?t\s+(been\s+)?shipped\b|\bwhere\s+is\s+my\s+(package|order|phone|device)\b/.test(
      hay,
    )
  ) {
    return 'Shipping';
  }

  // Call Center: can't reach them, long holds, transferred, IVR, no one answers, etc.
  if (
    /\bcall\s+center\b|\bcall\s+centre\b|\bcustomer\s+(service|support|care)\b.*\b(wait|hold|hour|transfer|reach|answer|ignore)\b|\bcannot\s+reach\b|\bcan'?t\s+reach\b|\bunable\s+to\s+reach\b|\bno\s+one\s+(answers?|picks?\s+up|responds?)\b|\bon\s+hold\b|\bhold\s+time\b|\bwait(?:ed|ing)?\s+(\d+\s+)?(hours?|hrs?|minutes?)\b.*\b(phone|call|support)\b|\btransferred?\s+(\d+\s+times?|around|again)\b|\bphone\s+tree\b|\bivr\b|\bkeep\s+(getting\s+)?(transferred|disconnected|hung\s+up)\b|\bhung\s+up\s+on\s+me\b|\bnever\s+(got|get)\s+(a\s+)?(person|human|agent|rep)\b|\bspeak\s+to\s+(a\s+)?(human|person|agent|manager|representative)\b|\bclosed\s+the\s+chat\b|\bchat\s+bot\b|\bno\s+response\s+from\s+support\b|\bignored\s+my\s+(calls?|emails?|messages?)\b/.test(
      hay,
    )
  ) {
    return 'CallCenter';
  }

  // --- Client hard-rules (product channel) ---
  for (const rule of CLIENT_BUSINESS_LINE_RULES) {
    if (rule.match.test(client)) return rule.line;
  }

  // Trade-In
  if (
    /\btrade[\s-]?in\b|\btradein\b|\btrade\s+in\s+(value|offer|program|credit|phone|device)\b|\bexchange\s+(my\s+)?(phone|device)\b|\bupgrade\s+program\b|\bcarrier\s+upgrade\b/.test(
      hay,
    )
  ) {
    return 'TradeIn';
  }

  // HomeTech — home appliances, TVs, home electronics (not mobile phones)
  const isHomeTechDevice =
    /\bhometech\b|\bhome\s*tech\b|\bhome\s+appliance|\bappliances?\b|\brefrigerator\b|\bfridge\b|\bdishwasher\b|\bwashing\s+machine\b|\bwasher\b|\bdryer\b|\bhvac\b|\bfurnace\b|\boven\b|\bstove\b|\bmicrowave\b|\btelevision\b|\boled\b|\bqled\b|\bsmart\s*tv\b|\bsmart\s+home\b|\bhome\s+electronics\b|\bgaming\s+console\b|\bps5\b|\bxbox\b|\bnintendo\b|\bdesktop\b|\bmonitor\b|\bpc\s+build\b|\blaptop\b|\bmacbook\b/.test(
      hay,
    );
  const isPhoneDevice =
    /\b(iphone|android\s+phone|cell\s*phone|smartphone|mobile\s+phone|phone\s+claim|phone\s+protection)\b/.test(
      hay,
    );
  if (isHomeTechDevice && !isPhoneDevice) {
    return 'HomeTech';
  }

  // Device Protection — phones / mobile devices / screen / wireless protection plans
  if (
    /\bdevice\s+protection\b|\bphone\s+(protection|insurance|warranty|claim|replacement)\b|\bmobile\s+protection\b|\bcracked\s+screen\b|\bscreen\s+(repair|replacement|protection)\b|\biphone\b|\bandroid\b|\bsmartphone\b|\bcell\s*phone\b|\bmobile\s+phone\b|\bwireless\s+protection\b|\baccidental\s+damage\b|\bphone\s+insurance\b|\bgadget\s+protection\b|\btablet\b|\bipad\b/.test(
      hay,
    )
  ) {
    return 'DP';
  }

  // Soft HomeTech fallback if client/channel strongly retail electronics and not phone-primary
  if (/best\s*buy|costco|sam'?s\s*club|target|walmart/i.test(client) && /\b(warranty|protection|claim)\b/.test(hay)) {
    if (/\b(phone|iphone|android|smartphone)\b/.test(hay)) return 'DP';
    return 'HomeTech';
  }

  return 'Other';
}

export function formatBusinessLine(line?: BusinessLine | string | null): string {
  if (!line) return BUSINESS_LINE_LABELS.Other;
  return BUSINESS_LINE_LABELS[line as BusinessLine] || String(line);
}

/**
 * Legacy Likewize keyword filter (kept for backward compatibility in overview).
 * Now we prefer the stricter isElectronicDeviceProtection + company detection.
 */
export function isLikewizeRelevant(item: {
  text?: string;
  title?: string;
  full_thread?: string;
  content?: string;
  [key: string]: any;
}): boolean {
  const haystack = [
    item.text || '',
    item.title || '',
    item.full_thread || '',
    item.content || '',
    (item as any).raw_data?.full_thread || '',
    (item as any).raw_data?.original?.title || '',
    (item as any).raw_data?.original?.selftext || '',
  ].join(' ').toLowerCase();

  return (
    haystack.includes('likewize') ||
    haystack.includes('like wize') ||
    haystack.includes('like-wize') ||
    haystack.includes('likewise')
  );
}
