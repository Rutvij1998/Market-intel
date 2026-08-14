/**
 * AI insights for alert digests — grounded in the subscriber's filtered matches only.
 * Uses SpaceXAI (xAI) when XAI_API_KEY is set; otherwise a deterministic rule summary.
 */

import { formatBusinessLine, type BusinessLine } from '@/lib/utils';

export type InsightSubscription = {
  all_clients: boolean;
  clients: string[];
  all_business_lines: boolean;
  business_lines: string[];
};

export type InsightMention = {
  client: string;
  businessLineLabel: string;
  source: string;
  sentiment: string;
  pillar: string;
  title: string;
  text: string;
};

export function describeSubscriptionFilters(sub: InsightSubscription): string {
  const parts: string[] = [];
  if (sub.all_clients) parts.push('All clients');
  else if (sub.clients?.length) parts.push(`Clients: ${sub.clients.join(', ')}`);
  else parts.push('No clients selected');

  if (sub.all_business_lines) parts.push('All business lines');
  else if (sub.business_lines?.length) {
    parts.push(
      `Lines: ${sub.business_lines.map((l) => formatBusinessLine(l as BusinessLine) || l).join(', ')}`,
    );
  } else parts.push('No business lines selected');

  return parts.join(' · ');
}

function ruleBasedInsights(matches: InsightMention[], filterLabel: string): string {
  if (!matches.length) {
    return [
      `No new public conversations matched your monitoring criteria (${filterLabel}) during this reporting period.`,
      `• Coverage remains limited to the clients and business lines you selected.`,
      `• Absence of new matches may indicate a quiet period, delayed source availability, or simply no qualifying discussions.`,
      `• No immediate customer outreach is indicated from this slice. Continue monitoring as scheduled.`,
    ].join('\n');
  }

  const bySentiment = { positive: 0, neutral: 0, negative: 0 };
  const byPillar = new Map<string, number>();
  const byClient = new Map<string, number>();
  for (const m of matches) {
    const s = (m.sentiment || 'neutral').toLowerCase();
    if (s === 'positive' || s === 'negative') bySentiment[s]++;
    else bySentiment.neutral++;
    byPillar.set(m.pillar || 'Other', (byPillar.get(m.pillar || 'Other') || 0) + 1);
    byClient.set(m.client, (byClient.get(m.client) || 0) + 1);
  }
  const topPillars = [...byPillar.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([p, n]) => `${p} (${n})`)
    .join(', ');
  const clients = [...byClient.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c} (${n})`)
    .join(', ');

  const lines = [
    `${matches.length} conversation${matches.length === 1 ? '' : 's'} matched your criteria (${filterLabel}).`,
    `• Sentiment mix: ${bySentiment.negative} negative · ${bySentiment.neutral} neutral · ${bySentiment.positive} positive.`,
    topPillars ? `• Leading themes: ${topPillars}.` : null,
    clients ? `• Distribution by client: ${clients}.` : null,
    bySentiment.negative > 0
      ? `• Recommendation: review negative threads first and, where appropriate, follow up via protect.likewize.com or direct message.`
      : `• Recommendation: scan for emerging themes; overall tone is not predominantly negative.`,
  ].filter(Boolean);

  return lines.join('\n');
}

/** Call xAI for a short executive insight block. Falls back to rules. */
export async function generateAlertInsights(opts: {
  sub: InsightSubscription;
  matches: InsightMention[];
  /** Optional: short label of what the screenshot shows */
  screenshotLabel?: string;
}): Promise<{ insights: string; provider: 'xai' | 'rules' }> {
  const filterLabel = describeSubscriptionFilters(opts.sub);
  const fallback = ruleBasedInsights(opts.matches, filterLabel);

  const apiKey = (process.env.XAI_API_KEY || process.env.GROK_API_KEY || '').trim();
  if (!apiKey) {
    return { insights: fallback, provider: 'rules' };
  }

  const model = (process.env.XAI_MODEL || 'grok-4-1-fast').trim();
  const sample = opts.matches.slice(0, 12).map((m, i) => ({
    n: i + 1,
    client: m.client,
    line: m.businessLineLabel,
    source: m.source,
    sentiment: m.sentiment,
    pillar: m.pillar,
    title: (m.title || m.text).slice(0, 120),
    excerpt: (m.text || '').replace(/\s+/g, ' ').trim().slice(0, 280),
  }));

  const system = `You are a senior market intelligence analyst preparing a stakeholder email for Likewize (device protection).
Write polished, executive-ready Insights for a professional digest.

Tone: calm, precise, board-appropriate. Avoid slang, casual phrasing, and technical jargon (never say "match count", "empty threads", "JSON", "slice", or "qualifying data").

Rules:
- Use ONLY the filtered data provided. Never invent clients, volumes, or events.
- Prefer 3–5 short bullets after a one-sentence summary. Use "• " for bullets. Plain text only (no # headings, no markdown bold).
- Focus on: what happened under the stated filters, sentiment/theme patterns, and a clear recommended next step when useful.
- If match count is zero: state that no new public conversations met the monitoring criteria for this period; note that monitoring is limited to the selected filters; do not invent issues; end with a calm note that no immediate action is indicated.`;

  const user = `Monitoring criteria: ${filterLabel}
${opts.screenshotLabel ? `Dashboard view captured: ${opts.screenshotLabel}` : ''}
Conversations in this report: ${opts.matches.length}

Conversation details (JSON for your analysis only — do not echo raw JSON in the output):
${JSON.stringify(sample, null, 0)}

Write the Insights section for the email.`;

  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        max_tokens: 500,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn('[alertInsights] xAI failed', res.status, errText.slice(0, 200));
      return { insights: fallback, provider: 'rules' };
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) return { insights: fallback, provider: 'rules' };
    return { insights: content.replace(/^#+\s*/gm, '').trim(), provider: 'xai' };
  } catch (e) {
    console.warn('[alertInsights] exception', e instanceof Error ? e.message : e);
    return { insights: fallback, provider: 'rules' };
  }
}
