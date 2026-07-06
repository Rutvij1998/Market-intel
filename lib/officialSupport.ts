export type SupportCompany = 'Asurion' | 'Likewize' | string;

export interface SupportComment {
  author?: string;
  body?: string;
  created_utc?: number;
}

/** Asurion's only known official Reddit support account. */
const ASURION_OFFICIAL_ACCOUNT = 'asurion_sam';

export function officialSupportPatterns(company: SupportCompany): string[] {
  if (company === 'Asurion') return [ASURION_OFFICIAL_ACCOUNT];
  // No known official Likewize Reddit account.
  return [];
}

export function normalizeRedditAuthor(author?: string): string {
  return (author || '').toLowerCase().trim().replace(/^u\//, '');
}

/** Brand names stored by old broken ingest — never valid official Reddit accounts. */
const INVALID_OFFICIAL_REPLIERS = new Set(['likewize', 'asurion', 'allstate', 'squaretrade']);

export function isOfficialSupportAuthor(author: string, company: SupportCompany): boolean {
  const normalized = normalizeRedditAuthor(author);
  if (!normalized || normalized === 'unknown' || normalized === '[deleted]') return false;
  if (INVALID_OFFICIAL_REPLIERS.has(normalized)) return false;

  if (company === 'Asurion') {
    return normalized === ASURION_OFFICIAL_ACCOUNT;
  }

  // Likewize has no official Reddit support account — never match brand name or guessed usernames.
  return false;
}

/** Parse u/Author: lines from the stored Reddit comments block only. */
export function extractOfficialAuthorsFromThread(full_thread?: string): string[] {
  if (!full_thread) return [];
  const marker = '\n\nComments:\n';
  const idx = full_thread.indexOf(marker);
  if (idx === -1) return [];

  const block = full_thread.slice(idx + marker.length);
  const authors: string[] = [];
  for (const line of block.split('\n')) {
    const match = line.match(/^u\/([^:]+):/i);
    if (match?.[1]) authors.push(match[1].trim());
  }
  return authors;
}

export function detectOfficialSupportReply(opts: {
  company: SupportCompany;
  comments?: SupportComment[];
  full_thread?: string;
  created_at?: string;
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

  const comments = opts.comments || [];

  // Primary: structured comment authors (reliable — used for reply timing).
  for (const comment of comments) {
    const author = comment.author || '';
    if (!isOfficialSupportAuthor(author, opts.company)) continue;
    has_official_reply = true;
    official_replier = author;
    if (typeof comment.created_utc === 'number' && !isNaN(postTs)) {
      const hours = (comment.created_utc * 1000 - postTs) / (1000 * 60 * 60);
      if (hours > 0 && hours < earliest) earliest = hours;
    }
  }

  // Fallback: parse u/Author: lines from stored full_thread (Asurion only — avoids Likewize false positives).
  if (!has_official_reply && opts.company === 'Asurion') {
    for (const author of extractOfficialAuthorsFromThread(opts.full_thread)) {
      if (!isOfficialSupportAuthor(author, opts.company)) continue;
      has_official_reply = true;
      official_replier = author;
      break;
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