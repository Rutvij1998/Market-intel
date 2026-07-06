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
  return s.includes('reddit') || s.includes('pissedconsumer') || s.includes('pissed');
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
