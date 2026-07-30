/**
 * Issue themes — go beyond bag-of-words to *what* is broken:
 * portal UX, replacement device quality, repair workmanship, service turnaround, etc.
 * Aggregated for Overview “Top pain points” / “What customers love”, business-line aware.
 */

import type { ClassifiedMention } from '@/lib/classify';
import {
  type BusinessLine,
  BUSINESS_LINE_LABELS,
  detectBusinessLine,
  formatBusinessLine,
} from '@/lib/utils';

export type ThemePolarity = 'pain' | 'love';

export interface IssueThemeDef {
  id: string;
  /** Short human label shown in the UI */
  label: string;
  /** One-line explanation of the real-world issue */
  insight: string;
  polarity: ThemePolarity;
  /** Prefer this business line when scoring / attribution is ambiguous */
  preferredLine?: BusinessLine;
  /** Patterns that indicate this concrete problem (not just a generic word) */
  patterns: RegExp[];
}

/**
 * Concrete issue catalog — ordered more specific first (first match wins per mention).
 * Multi-match allowed; a mention can count toward several themes if clear.
 */
export const ISSUE_THEMES: IssueThemeDef[] = [
  // ——— PAIN: digital / process ———
  {
    id: 'portal-ux',
    label: 'Portal / claim submission',
    insight: 'Website, app, or claim portal is blocking or frustrating the process',
    polarity: 'pain',
    preferredLine: 'DP',
    patterns: [
      /\b(portal|website|web\s*site|online\s+(form|claim|portal)|app\s+(crash|error|bug|won'?t)|login|log[\s-]?in|sign[\s-]?in|password|2fa|captcha|upload\s+(fail|error)|document\s+upload|can'?t\s+submit|unable\s+to\s+submit|form\s+(error|won'?t)|browser|chrome|safari)\b/i,
      /\b(claim\s+(portal|site|page|system)|online\s+system|their\s+site|broken\s+(link|page)|page\s+won'?t\s+load)\b/i,
    ],
  },
  // ——— PAIN: replacement device itself ———
  {
    id: 'replacement-device-quality',
    label: 'Replaced device quality',
    insight: 'The replacement unit was used, defective, wrong model, or a downgrade',
    polarity: 'pain',
    preferredLine: 'DP',
    patterns: [
      /\b(replacement\s+(phone|device|unit).{0,40}(broken|defective|used|refurbished|scratched|wrong|old|slower|worse)|got\s+a\s+(used|refurb|refurbished|damaged)|sent\s+(me\s+)?(a\s+)?(used|broken|defective)|downgrade[d]?|worse\s+(phone|device)|not\s+(the\s+)?same\s+model|wrong\s+(model|color|phone|device)|open[\s-]?box)\b/i,
      /\b(refurbished|refurb|certified\s+pre[\s-]?owned|cpo).{0,30}(phone|device|replacement)\b/i,
      /\b(replacement).{0,50}(already\s+broken|didn'?t\s+work|wouldn'?t\s+turn\s+on|defective)\b/i,
    ],
  },
  // ——— PAIN: repair workmanship on the device ———
  {
    id: 'repair-workmanship',
    label: 'Repair workmanship',
    insight: 'Device still broken or poorly fixed after a repair',
    polarity: 'pain',
    preferredLine: 'DP',
    patterns: [
      /\b(after\s+(the\s+)?repair|post[\s-]?repair|repaired).{0,40}(still\s+(broken|not\s+working)|same\s+issue|worse|broke\s+again|not\s+fixed|problem\s+persists)\b/i,
      /\b(poor|bad|shoddy|sloppy)\s+repair\b/i,
      /\b(screen).{0,25}(misaligned|bubbles|loose|falling|not\s+seated)\b/i,
      /\b(repair\s+(failed|didn'?t\s+work|made\s+it\s+worse)|botched\s+repair)\b/i,
    ],
  },
  // ——— PAIN: repair service process / depot ———
  {
    id: 'repair-service-process',
    label: 'Repair service process',
    insight: 'Depot / service logistics: long waits, no loaner, multiple trips',
    polarity: 'pain',
    preferredLine: 'DP',
    patterns: [
      /\b(depot|mail[\s-]?in|walk[\s-]?in|service\s+center|authorized\s+(repair|service)).{0,40}(wait|delay|week|month|slow)\b/i,
      /\b(no\s+loaner|without\s+a\s+loaner|loaner\s+(phone|device).{0,20}(not|never|refused))\b/i,
      /\b(repair).{0,30}(took\s+\d+|weeks?|months?|forever|too\s+long)\b/i,
      /\b(had\s+to\s+(ship|send|mail).{0,20}(again|twice|multiple)|multiple\s+(trips|visits)\s+to\s+(repair|depot))\b/i,
    ],
  },
  // ——— PAIN: shipping / fulfillment ———
  {
    id: 'shipping-fulfillment',
    label: 'Shipping & tracking',
    insight: 'Lost, delayed, or untrackable packages / devices in transit',
    polarity: 'pain',
    preferredLine: 'Shipping',
    patterns: [
      /\b(tracking|shipment|shipping|package|parcel|courier|fedex|ups|usps|dhl)\b.{0,40}\b(lost|missing|stuck|delayed|never\s+(arrived|showed|came)|no\s+update|wrong\s+address|return\s+to\s+sender)\b/i,
      /\b(never\s+(received|got|arrived).{0,25}(package|device|phone|box|order)|where\s+is\s+my\s+(package|order|phone|device))\b/i,
      /\b(out\s+for\s+delivery).{0,30}(never|not\s+delivered|failed)\b/i,
    ],
  },
  // ——— PAIN: claim economics ———
  {
    id: 'deductible-cost',
    label: 'Deductible & unexpected cost',
    insight: 'Surprise fees, high deductible, or charges that feel unfair',
    polarity: 'pain',
    preferredLine: 'DP',
    patterns: [
      /\b(deductible|excess|out[\s-]?of[\s-]?pocket|hidden\s+fee|extra\s+(charge|fee|cost)|unexpected\s+(charge|fee|cost)|overcharg)\b/i,
      /\b(charged\s+(me\s+)?\$?\d+|cost\s+too\s+much|expensive\s+(claim|repair|replacement)|not\s+worth\s+(the\s+)?(money|premium))\b/i,
    ],
  },
  // ——— PAIN: claim / coverage decision ———
  {
    id: 'claim-denial-coverage',
    label: 'Claim denial / coverage gap',
    insight: 'Claim denied or coverage narrower than expected',
    polarity: 'pain',
    preferredLine: 'DP',
    patterns: [
      /\b(claim\s+(was\s+)?(denied|rejected)|denial|deny|denied\s+my\s+claim|not\s+covered|coverage\s+(denied|refused|void)|excluded|exclusion|policy\s+doesn'?t\s+cover)\b/i,
      /\b(said\s+it\s+(wasn'?t|was\s+not)\s+covered|won'?t\s+cover|refuse[d]?\s+to\s+(cover|pay|replace))\b/i,
    ],
  },
  // ——— PAIN: support access ———
  {
    id: 'call-center-access',
    label: 'Can’t reach support',
    insight: 'Holds, transfers, language barriers, or no human help',
    polarity: 'pain',
    preferredLine: 'CallCenter',
    patterns: [
      /\b(on\s+hold|hold\s+time|wait(?:ed|ing)?\s+(\d+\s+)?(hours?|hrs?|minutes?)|transferred?\s+(\d+\s+times?|again|around)|phone\s+tree|ivr|speak\s+to\s+(a\s+)?(human|person|agent|manager)|language\s+barrier|can'?t\s+understand|no\s+one\s+(answers?|picks?\s+up)|hung\s+up\s+on)\b/i,
      /\b(call\s+center|customer\s+(service|support)).{0,40}(useless|unhelpful|nightmare|impossible|hours)\b/i,
    ],
  },
  // ——— PAIN: trade-in ———
  {
    id: 'tradein-valuation',
    label: 'Trade-in valuation dispute',
    insight: 'Offer lower than expected or condition disputed after send-in',
    polarity: 'pain',
    preferredLine: 'TradeIn',
    patterns: [
      /\b(trade[\s-]?in|tradein).{0,50}(low|lower|less|dispute|disputed|undervalue|under[\s-]?value|quoted|offer|value|declined|rejected)\b/i,
      /\b(valuation|quote).{0,30}(lower|less|changed|bait)\b/i,
      /\b(said\s+(it\s+was|device\s+was)\s+(damaged|cracked|not\s+as\s+described)).{0,40}(trade|value|offer)\b/i,
    ],
  },
  // ——— PAIN: silence / follow-up ———
  {
    id: 'no-response-followup',
    label: 'No response / follow-up',
    insight: 'Tickets, emails, or chats go unanswered',
    polarity: 'pain',
    preferredLine: 'CallCenter',
    patterns: [
      /\b(no\s+response|never\s+(heard|got\s+back|replied|responded)|ignored\s+my\s+(email|call|message|ticket)|ghosted|still\s+waiting\s+(for\s+)?(a\s+)?(reply|response|callback|call\s+back)|no\s+callback|won'?t\s+email\s+me\s+back)\b/i,
      /\b(ticket|case|chat).{0,30}(closed|ignored|no\s+update|abandoned)\b/i,
    ],
  },
  // ——— PAIN: generic device failure still relevant ———
  {
    id: 'device-still-broken',
    label: 'Device still unusable',
    insight: 'Core device problem not resolved after engaging support/plan',
    polarity: 'pain',
    preferredLine: 'DP',
    patterns: [
      /\b(still\s+(broken|not\s+working|dead|unusable)|phone\s+(still\s+)?(won'?t|doesn'?t)\s+(turn\s+on|work)|no\s+(working\s+)?phone|without\s+a\s+phone\s+for)\b/i,
    ],
  },

  // ——— LOVE ———
  {
    id: 'warranty-honored',
    label: 'Warranty / claim honored',
    insight: 'Coverage worked as expected and claim was approved smoothly',
    polarity: 'love',
    preferredLine: 'DP',
    patterns: [
      /\b(claim\s+(was\s+)?(approved|accepted|honored)|warranty\s+(honored|covered)|they\s+covered|fully\s+covered|no\s+hassle\s+claim|easy\s+claim)\b/i,
      /\b(honored\s+(the\s+)?(warranty|claim|policy)|stood\s+by\s+(their|the)\s+(warranty|policy))\b/i,
    ],
  },
  {
    id: 'repair-quality-good',
    label: 'Repair quality',
    insight: 'Fix was done well; device works properly afterward',
    polarity: 'love',
    preferredLine: 'DP',
    patterns: [
      /\b(great|excellent|perfect|solid|good)\s+repair\b/i,
      /\b(repair).{0,30}(looks?\s+new|works?\s+perfectly|like\s+new|fixed\s+(it\s+)?(perfectly|completely|properly))\b/i,
      /\b(screen|device|phone).{0,20}(fixed|repaired).{0,20}(perfectly|great|well)\b/i,
    ],
  },
  {
    id: 'coverage-clarity',
    label: 'Coverage clarity',
    insight: 'Policy and next steps were easy to understand',
    polarity: 'love',
    preferredLine: 'DP',
    patterns: [
      /\b(clear\s+(coverage|policy|instructions|process)|explained\s+(clearly|everything)|easy\s+to\s+understand|transparent|no\s+fine\s+print\s+surprises)\b/i,
      /\b(knew\s+exactly\s+what|walked\s+me\s+through|straightforward\s+(process|claim|coverage))\b/i,
    ],
  },
  {
    id: 'on-time-delivery',
    label: 'On-time delivery',
    insight: 'Device or package arrived when promised',
    polarity: 'love',
    preferredLine: 'Shipping',
    patterns: [
      /\b(on[\s-]?time|arrived\s+(quickly|fast|early|next\s+day|same\s+day)|fast\s+(shipping|delivery)|quick\s+(shipping|delivery)|delivered\s+(promptly|quickly)|tracking\s+was\s+(accurate|great|clear))\b/i,
    ],
  },
  {
    id: 'technician-skill',
    label: 'Technician skill',
    insight: 'In-person tech was skilled and professional',
    polarity: 'love',
    preferredLine: 'HomeTech',
    patterns: [
      /\b(technician|tech|engineer|specialist).{0,30}(great|excellent|skilled|professional|knowledgeable|friendly|amazing)\b/i,
      /\b(great|excellent|professional|skilled)\s+(technician|tech|repair\s+tech)\b/i,
    ],
  },
  {
    id: 'fast-turnaround',
    label: 'Fast turnaround',
    insight: 'Claim, repair, or replacement completed quickly',
    polarity: 'love',
    preferredLine: 'DP',
    patterns: [
      /\b(fast|quick|speedy|same[\s-]?day|next[\s-]?day|within\s+(a\s+)?(day|hours?))\s+(repair|replacement|turnaround|service|claim|resolution)\b/i,
      /\b(repair|replacement|claim).{0,25}(same\s+day|next\s+day|in\s+(a\s+)?(few\s+)?hours|quickly|fast)\b/i,
      /\b(resolved\s+(quickly|fast)|quick\s+resolution|turned\s+around\s+(fast|quickly))\b/i,
    ],
  },
  {
    id: 'good-replacement-device',
    label: 'Solid replacement device',
    insight: 'Replacement unit was new/like-new and worked well',
    polarity: 'love',
    preferredLine: 'DP',
    patterns: [
      /\b(replacement).{0,40}(brand\s+new|like\s+new|perfect|works?\s+great|excellent|better\s+than)\b/i,
      /\b(new\s+(phone|device)|got\s+a\s+new).{0,30}(happy|love|perfect|great)\b/i,
    ],
  },
  {
    id: 'easy-portal-process',
    label: 'Easy online process',
    insight: 'Portal / app made filing or tracking simple',
    polarity: 'love',
    preferredLine: 'DP',
    patterns: [
      /\b(easy|simple|smooth|seamless)\s+(portal|online|app|website|process|claim\s+process)\b/i,
      /\b(portal|app|website|online).{0,25}(easy|simple|intuitive|user[\s-]?friendly)\b/i,
    ],
  },
  {
    id: 'fair-tradein',
    label: 'Fair trade-in value',
    insight: 'Trade-in offer felt fair and process was clean',
    polarity: 'love',
    preferredLine: 'TradeIn',
    patterns: [
      /\b(trade[\s-]?in|tradein).{0,40}(fair|good\s+(value|offer|price)|generous|happy\s+with|great\s+value)\b/i,
    ],
  },
  {
    id: 'helpful-support',
    label: 'Helpful support agent',
    insight: 'Agent resolved the issue with care',
    polarity: 'love',
    preferredLine: 'CallCenter',
    patterns: [
      /\b(helpful|amazing|wonderful|great|patient)\s+(agent|rep|representative|support|cs)\b/i,
      /\b(agent|rep|support).{0,30}(went\s+above|saved\s+me|so\s+helpful|resolved|sorted)\b/i,
    ],
  },
];

export interface ThemeHit {
  themeId: string;
  label: string;
  insight: string;
  polarity: ThemePolarity;
}

export function haystackOfMention(m: ClassifiedMention): string {
  return [m.title, m.text, m.full_thread, m.key_issue]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

/** Detect concrete issue themes in a mention (can return multiple). */
export function detectIssueThemes(
  m: ClassifiedMention,
  polarity?: ThemePolarity,
): ThemeHit[] {
  const hay = haystackOfMention(m);
  if (!hay.trim()) return [];

  const hits: ThemeHit[] = [];
  for (const theme of ISSUE_THEMES) {
    if (polarity && theme.polarity !== polarity) continue;
    // For pain themes, prefer negative/neutral mentions; for love, prefer positive
    if (theme.polarity === 'pain' && m.sentiment === 'positive') continue;
    if (theme.polarity === 'love' && m.sentiment === 'negative') continue;

    const matched = theme.patterns.some((re) => re.test(hay));
    if (matched) {
      hits.push({
        themeId: theme.id,
        label: theme.label,
        insight: theme.insight,
        polarity: theme.polarity,
      });
    }
  }
  return hits;
}

export interface AggregatedTheme {
  id: string;
  label: string;
  insight: string;
  polarity: ThemePolarity;
  mentions: number;
  /** Share of the polarity pool (0–100) */
  pct: number;
  /** Dominant business line among hits */
  businessLine: BusinessLine;
  businessLineLabel: string;
  /** Matching threads for drill-down (newest first) */
  threads: ClassifiedMention[];
  /** Sample mention ids (first few thread ids) */
  sampleIds: string[];
}

/**
 * Rank themes for a mention set.
 * - pain: mostly negative (and some neutral) pool
 * - love: positive pool
 */
export function aggregateIssueThemes(
  mentions: ClassifiedMention[],
  polarity: ThemePolarity,
  limit = 6,
): AggregatedTheme[] {
  const pool =
    polarity === 'pain'
      ? mentions.filter((m) => m.sentiment === 'negative' || m.sentiment === 'neutral')
      : mentions.filter((m) => m.sentiment === 'positive');

  // Prefer pure negative for pain ranking denominator
  const denomPool =
    polarity === 'pain'
      ? mentions.filter((m) => m.sentiment === 'negative')
      : pool;
  const denom = Math.max(denomPool.length, 1);

  type Acc = {
    def: IssueThemeDef;
    count: number;
    lines: Map<BusinessLine, number>;
    threads: ClassifiedMention[];
  };
  const acc = new Map<string, Acc>();

  for (const m of pool) {
    // Pain: only count on negatives for ranking (neutral can soft-match but not inflate)
    if (polarity === 'pain' && m.sentiment !== 'negative') continue;

    const hits = detectIssueThemes(m, polarity);
    if (!hits.length) continue;

    const line = (m.business_line || detectBusinessLine(m as any)) as BusinessLine;
    const seen = new Set<string>();

    for (const h of hits) {
      if (seen.has(h.themeId)) continue;
      seen.add(h.themeId);
      const def = ISSUE_THEMES.find((t) => t.id === h.themeId)!;
      let row = acc.get(h.themeId);
      if (!row) {
        row = { def, count: 0, lines: new Map(), threads: [] };
        acc.set(h.themeId, row);
      }
      row.count += 1;
      row.lines.set(line, (row.lines.get(line) || 0) + 1);
      row.threads.push(m);
    }
  }

  const ranked = Array.from(acc.values())
    .map((row) => {
      let topLine: BusinessLine = row.def.preferredLine || 'Other';
      let topN = -1;
      for (const [line, n] of row.lines) {
        if (n > topN) {
          topN = n;
          topLine = line;
        }
      }
      const threads = [...row.threads].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      return {
        id: row.def.id,
        label: row.def.label,
        insight: row.def.insight,
        polarity: row.def.polarity,
        mentions: row.count,
        pct: Math.round((row.count / denom) * 100),
        businessLine: topLine,
        businessLineLabel:
          formatBusinessLine(topLine) || BUSINESS_LINE_LABELS[topLine] || topLine,
        threads,
        sampleIds: threads.slice(0, 8).map((t) => t.id),
      } satisfies AggregatedTheme;
    })
    .sort((a, b) => b.mentions - a.mentions || b.pct - a.pct)
    .slice(0, limit);

  return ranked;
}
