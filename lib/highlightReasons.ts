/**
 * Why-this-thread highlights for the insight panel.
 * Surfaces brand / client / business-line / pillar evidence that put a mention
 * into the current filtered Recent Insights view.
 */

import type { ClassifiedMention, Pillar } from '@/lib/classify';
import {
  type BusinessLine,
  BUSINESS_LINE_LABELS,
  formatBusinessLine,
  getMentionClient,
} from '@/lib/utils';

export type HighlightKind = 'brand' | 'client' | 'business_line' | 'pillar' | 'support';

export interface HighlightReason {
  id: string;
  kind: HighlightKind;
  /** Short chip label shown in the legend */
  label: string;
  /** Optional detail under the chip */
  detail?: string;
  /** Terms to mark in the thread body (case-insensitive) */
  terms: string[];
  /** CSS class applied to <mark> */
  markClass: string;
  /** Chip background / border tint */
  chipClass: string;
}

export interface InsightFilterContext {
  activeClient?: string;
  activeBusinessLine?: 'All' | BusinessLine;
  drillPillar?: Pillar | null;
  activeTab?: 'overview' | 'competitor';
}

/** Brand aliases — includes "likewise" (English adverb / common typo of Likewize). */
const BRAND_TERM_GROUPS: Array<{
  id: string;
  label: string;
  terms: string[];
  detail?: string;
}> = [
  {
    id: 'brand-likewize',
    label: 'Brand · Likewize',
    terms: ['likewize', 'like wize', 'like-wize', 'likewise'],
    detail: 'Matched a Likewize brand string (includes “likewise”, which can be a typo for “Likewise”).',
  },
  {
    id: 'brand-asurion',
    label: 'Brand · Asurion',
    terms: ['asurion', 'asurion_sam', 'asurion-sam'],
  },
  {
    id: 'brand-allstate',
    label: 'Brand · Allstate',
    terms: ['allstate', 'all state', 'allstate protection'],
  },
  {
    id: 'brand-squaretrade',
    label: 'Brand · SquareTrade',
    terms: ['squaretrade', 'square trade'],
  },
];

const BUSINESS_LINE_TERMS: Record<BusinessLine, string[]> = {
  DP: [
    'device protection',
    'phone protection',
    'phone insurance',
    'phone warranty',
    'phone claim',
    'mobile protection',
    'cracked screen',
    'screen repair',
    'screen replacement',
    'screen protection',
    'accidental damage',
    'wireless protection',
    'gadget protection',
    'iphone',
    'android',
    'smartphone',
    'cell phone',
    'mobile phone',
    'tablet',
    'ipad',
  ],
  HomeTech: [
    'hometech',
    'home tech',
    'home appliance',
    'appliance',
    'refrigerator',
    'fridge',
    'dishwasher',
    'washing machine',
    'washer',
    'dryer',
    'hvac',
    'furnace',
    'oven',
    'stove',
    'microwave',
    'television',
    'smart tv',
    'oled',
    'qled',
    'smart home',
    'home electronics',
    'gaming console',
    'ps5',
    'xbox',
    'nintendo',
    'desktop',
    'laptop',
    'macbook',
  ],
  TradeIn: [
    'trade-in',
    'trade in',
    'tradein',
    'trade in value',
    'trade in offer',
    'trade in program',
    'upgrade program',
    'carrier upgrade',
    'exchange my phone',
    'exchange my device',
  ],
  Shipping: [
    'shipping',
    'shipped',
    'shipment',
    'not delivered',
    'never arrived',
    'never received',
    'package lost',
    'package missing',
    'package delayed',
    'tracking number',
    'tracking',
    'courier',
    'fedex',
    'ups',
    'usps',
    'dhl',
    'in transit',
    'out for delivery',
    'return to sender',
    'delivery delay',
    'hasnt been shipped',
    "hasn't been shipped",
    'where is my package',
    'where is my order',
  ],
  CallCenter: [
    'call center',
    'call centre',
    'customer service',
    'customer support',
    'customer care',
    'cannot reach',
    "can't reach",
    'unable to reach',
    'no one answers',
    'no one picks up',
    'on hold',
    'hold time',
    'waiting hours',
    'transferred',
    'phone tree',
    'ivr',
    'hung up on me',
    'speak to a human',
    'speak to a person',
    'speak to a manager',
    'chat bot',
    'chatbot',
    'no response from support',
    'ignored my calls',
    'ignored my emails',
  ],
  Other: [],
};

const PILLAR_TERMS: Record<Pillar, string[]> = {
  Claims: ['claims', 'claim', 'denied', 'denial', 'deny', 'approval', 'approved', 'claim denied'],
  Repair: ['repair', 'repaired', 'fix', 'screen crack', 'cracked screen', 'fixing'],
  Replacement: ['replacement', 'replace', 'new phone', 'loaner', 'replaced'],
  'Customer Service': [
    'customer service',
    'customer support',
    'support',
    'agent',
    'representative',
    'rep',
    'service',
  ],
  Reimbursements: [
    'reimbursement',
    'reimburse',
    'refund',
    'money back',
    'payment',
    'charged',
    'charge',
  ],
  'Call Center': [
    'call center',
    'call centre',
    'phone tree',
    'ivr',
    'on hold',
    'hold time',
    'transferred',
  ],
  Other: [],
};

const KIND_STYLES: Record<HighlightKind, { markClass: string; chipClass: string }> = {
  brand: {
    markClass: 'mv-hl-brand',
    chipClass: 'mv-hl-chip-brand',
  },
  client: {
    markClass: 'mv-hl-client',
    chipClass: 'mv-hl-chip-client',
  },
  business_line: {
    markClass: 'mv-hl-biz',
    chipClass: 'mv-hl-chip-biz',
  },
  pillar: {
    markClass: 'mv-hl-pillar',
    chipClass: 'mv-hl-chip-pillar',
  },
  support: {
    markClass: 'mv-hl-support',
    chipClass: 'mv-hl-chip-support',
  },
};

function haystackOf(m: ClassifiedMention): string {
  return [m.title, m.text, m.full_thread, m.client, m.subreddit, m.source]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

function termsFoundIn(text: string, terms: string[]): string[] {
  const lower = text.toLowerCase();
  // Longer phrases first so we prefer multi-word matches for display
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  const found: string[] = [];
  for (const t of sorted) {
    if (!t) continue;
    if (lower.includes(t.toLowerCase())) found.push(t);
  }
  return found;
}

function clientSearchTerms(client: string): string[] {
  const c = (client || '').trim();
  if (!c || c === 'All' || c === 'Unassigned') return [];
  const terms = new Set<string>();
  terms.add(c);
  terms.add(c.toLowerCase());
  // Drop parenthetical extras: "PissedConsumer (Direct)" → also "PissedConsumer"
  const base = c.replace(/\s*\([^)]*\)\s*/g, '').trim();
  if (base) terms.add(base);
  // Multi-word clients: add significant tokens (Rogers, Newegg, Boost, Mobile…)
  for (const part of base.split(/[\s/]+/).filter((p) => p.length >= 3)) {
    // skip generic words
    if (/^(the|and|for|inc|llc|mobile|wireless|direct)$/i.test(part)) continue;
    terms.add(part);
  }
  // Subreddit form
  terms.add(`r/${base}`);
  return Array.from(terms);
}

/**
 * Build ordered highlight reasons for a mention under the current filters.
 * Active filters always contribute; brand hits always surface when present in text.
 */
export function getInsightHighlightReasons(
  mention: ClassifiedMention,
  ctx: InsightFilterContext = {},
): HighlightReason[] {
  const hay = haystackOf(mention);
  const reasons: HighlightReason[] = [];
  const seen = new Set<string>();

  const push = (r: HighlightReason) => {
    if (seen.has(r.id)) return;
    // Keep reasons that either have in-text hits OR are active filters (explain even if rare)
    if (r.terms.length === 0 && r.kind !== 'client' && r.kind !== 'business_line' && r.kind !== 'pillar') {
      return;
    }
    seen.add(r.id);
    reasons.push(r);
  };

  // 1) Brand evidence in the thread (always — explains Overview / competitor inclusion)
  for (const group of BRAND_TERM_GROUPS) {
    const found = termsFoundIn(hay, group.terms);
    if (!found.length) continue;
    // Prefer listing the actual matched spellings
    const styles = KIND_STYLES.brand;
    push({
      id: group.id,
      kind: 'brand',
      label: group.label,
      detail: group.detail,
      terms: found,
      ...styles,
    });
  }

  // 2) Client — when filter is active, or always show the mention's client channel
  const filterClient = ctx.activeClient && ctx.activeClient !== 'All' ? ctx.activeClient : null;
  const mentionClient = getMentionClient(mention as any);
  const clientFocus = filterClient || (mentionClient && mentionClient !== 'Unassigned' ? mentionClient : null);
  if (clientFocus) {
    const terms = termsFoundIn(hay, clientSearchTerms(clientFocus));
    // Also search client label itself even if only on metadata
    const styles = KIND_STYLES.client;
    push({
      id: `client-${clientFocus}`,
      kind: 'client',
      label: filterClient ? `Client filter · ${clientFocus}` : `Client · ${clientFocus}`,
      detail: filterClient
        ? `Shown because client filter is “${clientFocus}”.`
        : `Tagged to client / channel “${clientFocus}”.`,
      terms: terms.length ? terms : clientSearchTerms(clientFocus).slice(0, 3),
      ...styles,
    });
  }

  // 3) Business line — when filter active, highlight that line's keywords; else show mention's line
  const mentionLine = (mention.business_line || null) as BusinessLine | null;
  const filterLine =
    ctx.activeBusinessLine && ctx.activeBusinessLine !== 'All' ? ctx.activeBusinessLine : null;
  const lineFocus = filterLine || mentionLine;
  if (lineFocus && lineFocus !== 'Other') {
    const vocab = BUSINESS_LINE_TERMS[lineFocus] || [];
    const found = termsFoundIn(hay, vocab);
    const styles = KIND_STYLES.business_line;
    const nice = formatBusinessLine(lineFocus) || BUSINESS_LINE_LABELS[lineFocus] || lineFocus;
    push({
      id: `biz-${lineFocus}`,
      kind: 'business_line',
      label: filterLine ? `Business line · ${nice}` : `Business line · ${nice}`,
      detail: filterLine
        ? `Shown under the “${nice}” business-line filter.`
        : `Classified as ${nice} from issue / device / client signals.`,
      terms: found.length ? found : vocab.slice(0, 4),
      ...styles,
    });
  }

  // 4) Pillar — active drill takes priority; else mention pillar
  const filterPillar = ctx.drillPillar || null;
  const pillarFocus = filterPillar || mention.pillar || null;
  if (pillarFocus && pillarFocus !== 'Other') {
    const vocab = PILLAR_TERMS[pillarFocus] || [pillarFocus.toLowerCase()];
    const found = termsFoundIn(hay, vocab);
    const styles = KIND_STYLES.pillar;
    push({
      id: `pillar-${pillarFocus}`,
      kind: 'pillar',
      label: filterPillar ? `Pillar filter · ${pillarFocus}` : `Pillar · ${pillarFocus}`,
      detail: filterPillar
        ? `Shown because the pillar drill is “${pillarFocus}”.`
        : `Classified under pillar “${pillarFocus}”.`,
      terms: found.length ? found : vocab.slice(0, 4),
      ...styles,
    });
  }

  // 5) Official support (Asurion_Sam) when present
  if (
    mention.has_official_reply &&
    /asurion[_-]?sam/i.test(String(mention.official_replier || 'asurion_sam'))
  ) {
    const found = termsFoundIn(hay, ['asurion_sam', 'asurion-sam', 'asurion sam', 'u/asurion_sam']);
    push({
      id: 'support-sam',
      kind: 'support',
      label: 'Official reply · Asurion_Sam',
      detail: 'Thread counted because u/Asurion_Sam replied.',
      terms: found.length ? found : ['asurion_sam', 'Asurion_Sam'],
      ...KIND_STYLES.support,
    });
  }

  // Prefer active-filter reasons first in the legend
  const priority = (r: HighlightReason): number => {
    if (r.kind === 'brand') return 0;
    if (filterClient && r.kind === 'client') return 1;
    if (filterLine && r.kind === 'business_line') return 2;
    if (filterPillar && r.kind === 'pillar') return 3;
    if (r.kind === 'support') return 4;
    return 10;
  };
  reasons.sort((a, b) => priority(a) - priority(b));

  return reasons;
}

export interface HighlightSegment {
  text: string;
  reasonId?: string;
  markClass?: string;
}

/**
 * Split `text` into plain + marked segments using reason terms.
 * Longer terms win; overlapping later matches are skipped.
 */
export function segmentHighlightedText(
  text: string,
  reasons: HighlightReason[],
): HighlightSegment[] {
  if (!text) return [];
  if (!reasons.length) return [{ text }];

  // Flatten terms → reason, longest first
  type TermHit = { term: string; reason: HighlightReason };
  const termList: TermHit[] = [];
  for (const r of reasons) {
    for (const t of r.terms) {
      if (t && t.trim()) termList.push({ term: t.trim(), reason: r });
    }
  }
  termList.sort((a, b) => b.term.length - a.term.length);

  if (!termList.length) return [{ text }];

  // Escape for regex; allow flexible whitespace for multi-word terms
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = termList
    .map(({ term }) => escape(term).replace(/\s+/g, '\\s+'))
    .join('|');
  if (!pattern) return [{ text }];

  const re = new RegExp(`(${pattern})`, 'gi');
  const parts = text.split(re);
  const segments: HighlightSegment[] = [];

  for (const part of parts) {
    if (!part) continue;
    const match = termList.find((t) => {
      const flex = new RegExp(`^${escape(t.term).replace(/\\s+/g, '\\s+')}$`, 'i');
      return flex.test(part);
    });
    if (match) {
      segments.push({
        text: part,
        reasonId: match.reason.id,
        markClass: match.reason.markClass,
      });
    } else {
      segments.push({ text: part });
    }
  }

  return segments;
}
