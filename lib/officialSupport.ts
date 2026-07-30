export type SupportCompany = 'Asurion' | 'Likewize' | string;

export interface SupportComment {
  author?: string;
  body?: string;
  created_utc?: number;
}

/** Asurion's known official Reddit support account(s). */
export const ASURION_OFFICIAL_ACCOUNT = 'asurion_sam';
const ASURION_OFFICIAL_ALIASES = new Set([
  'asurion_sam',
  'asurionsam',
  'asurion-sam',
]);

export function officialSupportPatterns(company: SupportCompany): string[] {
  if (company === 'Asurion') return [ASURION_OFFICIAL_ACCOUNT];
  // No known official Likewize Reddit account.
  return [];
}

export function normalizeRedditAuthor(author?: string): string {
  return (author || '')
    .toLowerCase()
    .trim()
    .replace(/^u\//, '')
    .replace(/^\/u\//, '')
    .replace(/\s+/g, '');
}

/** Brand names stored by old broken ingest — never valid official Reddit accounts. */
const INVALID_OFFICIAL_REPLIERS = new Set(['likewize', 'asurion', 'allstate', 'squaretrade']);

export function isOfficialSupportAuthor(author: string, company: SupportCompany): boolean {
  const normalized = normalizeRedditAuthor(author);
  if (!normalized || normalized === 'unknown' || normalized === '[deleted]') return false;
  if (INVALID_OFFICIAL_REPLIERS.has(normalized)) return false;

  if (company === 'Asurion') {
    return ASURION_OFFICIAL_ALIASES.has(normalized) || normalized === ASURION_OFFICIAL_ACCOUNT;
  }

  // Likewize has no official Reddit support account — never match brand name or guessed usernames.
  return false;
}

/** Parse u/Author: lines from stored Reddit comments block (tolerant of formatting). */
export function extractOfficialAuthorsFromThread(full_thread?: string): string[] {
  if (!full_thread) return [];
  const authors: string[] = [];

  // Prefer the Comments: block when present, else scan whole thread
  const marker = '\n\nComments:\n';
  const idx = full_thread.indexOf(marker);
  const block = idx === -1 ? full_thread : full_thread.slice(idx + marker.length);

  for (const line of block.split('\n')) {
    // u/Asurion_Sam: ...   or   /u/Asurion_Sam: ...
    const match = line.match(/^(?:\/?u\/)?([A-Za-z0-9_-]+)\s*:/i);
    if (match?.[1]) authors.push(match[1].trim());
  }

  // Also catch inline mentions like "Asurion_Sam replied" style author tags
  const global = full_thread.matchAll(/(?:^|\s)(?:\/?u\/)(asurion[_-]?sam)\b/gi);
  for (const m of global) {
    if (m[1]) authors.push(m[1]);
  }

  return authors;
}

/**
 * Detect whether Asurion_Sam (or company official) replied.
 * Checks structured comments first, then full_thread author lines, then raw blob.
 */
export function detectOfficialSupportReply(opts: {
  company: SupportCompany;
  comments?: SupportComment[];
  full_thread?: string;
  created_at?: string;
  /** Extra comments known from Asurion_Sam user history for this post */
  knownOfficialComments?: SupportComment[];
}): {
  has_official_reply: boolean;
  first_official_reply_hours: number | null;
  official_replier: string | null;
} {
  if (opts.company !== 'Asurion' && opts.company !== 'Likewize') {
    return { has_official_reply: false, first_official_reply_hours: null, official_replier: null };
  }

  let has_official_reply = false;
  let official_replier: string | null = null;
  let earliest = Infinity;
  const postTs = opts.created_at ? new Date(opts.created_at).getTime() : NaN;

  const comments = [
    ...(opts.comments || []),
    ...(opts.knownOfficialComments || []),
  ];

  // Primary: structured comment authors (reliable — used for reply timing).
  for (const comment of comments) {
    const author = comment.author || '';
    if (!isOfficialSupportAuthor(author, opts.company)) continue;
    has_official_reply = true;
    official_replier = author || ASURION_OFFICIAL_ACCOUNT;
    if (typeof comment.created_utc === 'number' && !isNaN(postTs)) {
      const hours = (comment.created_utc * 1000 - postTs) / (1000 * 60 * 60);
      // Allow near-instant replies; ignore impossible negatives / multi-year outliers
      if (hours >= -0.05 && hours <= 24 * 60 && hours < earliest) {
        earliest = Math.max(hours, 0.01);
      }
    }
  }

  // Fallback: parse author lines / u/Asurion_Sam from full_thread (Asurion only).
  if (!has_official_reply && opts.company === 'Asurion') {
    for (const author of extractOfficialAuthorsFromThread(opts.full_thread)) {
      if (!isOfficialSupportAuthor(author, opts.company)) continue;
      has_official_reply = true;
      official_replier = author;
      break;
    }
  }

  // Last resort: any asurion_sam token in the stored thread/comment blob for Asurion
  if (!has_official_reply && opts.company === 'Asurion') {
    const blob = `${opts.full_thread || ''} ${JSON.stringify(opts.comments || [])}`;
    if (/\basurion[_-]?sam\b/i.test(blob)) {
      has_official_reply = true;
      official_replier = 'Asurion_Sam';
    }
  }

  return {
    has_official_reply,
    first_official_reply_hours:
      has_official_reply && earliest < Infinity ? Math.round(earliest * 10) / 10 : null,
    official_replier,
  };
}

export function isRedditMention(source?: string): boolean {
  return (source || '').toLowerCase().includes('reddit');
}

/** Normalize a reddit post id to `reddit-<id>` form. */
export function toRedditMentionId(idOrThing?: string | null): string | null {
  if (!idOrThing) return null;
  let s = String(idOrThing).trim();
  // t3_abc123 → abc123
  s = s.replace(/^t3_/, '');
  s = s.replace(/^reddit-/, '');
  if (!s) return null;
  return `reddit-${s}`;
}