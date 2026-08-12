/**
 * Draft public community replies for Likewize:
 * short, we/us voice, sorry + we want to help fully, DM or portal, we'll take care of it.
 * Never use first-person "I". Never say we can't help in a public thread.
 */

export const LIKEWIZE_PORTAL_URL = 'https://protect.likewize.com';

export type DraftReplyMode = 'generate' | 'rewrite';

export type DraftReplyInput = {
  text: string;
  title?: string | null;
  source?: string | null;
  client?: string | null;
  subreddit?: string | null;
  author?: string | null;
  sentiment?: string | null;
  pillar?: string | null;
  key_issue?: string | null;
  company?: string | null;
  business_line?: string | null;
  url?: string | null;
  mode?: DraftReplyMode;
  draftText?: string | null;
  previousReply?: string | null;
  variation?: number | null;
  nonce?: string | null;
};

export type DraftReplyResult = {
  reply: string;
  provider: 'xai' | 'template';
  portalUrl: string;
  mode: DraftReplyMode;
  warning?: string | null;
};

const PORTAL = LIKEWIZE_PORTAL_URL;

/** Target tone examples (polish — never copy verbatim). */
const STYLE_EXAMPLES = `
Good examples (Likewize voice, we/us only):

1) "Hey there — we're really sorry this happened. We want to fully help you get this sorted. Please leave us a DM or reach out at ${PORTAL} and we'll make sure you're taken care of."

2) "Sorry about the tracking / claim mess. That's not okay. We'd love to help make this right — DM us or hop over to ${PORTAL} and our team will take care of you."

3) "Hey — sorry you went through that. We want to help end to end. Reach out on ${PORTAL} or send us a DM and we'll make sure this gets handled."

4) (positive) "That's great to hear! Appreciate you sharing. If you ever need us: ${PORTAL} or just DM us."

Never say: "we can't handle this in a public thread", "we don't have access on Reddit", "we can't fix claim details here".
`;

function clean(s: unknown): string {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveSentiment(input: DraftReplyInput): 'positive' | 'negative' | 'neutral' {
  const tagged = (input.sentiment || '').toLowerCase();
  if (tagged === 'positive' || tagged === 'negative' || tagged === 'neutral') return tagged;

  const blob = `${input.title || ''} ${input.text || ''}`.toLowerCase();
  const neg =
    /(terrible|awful|scam|fraud|fake|worst|horrible|disgusting|ripoff|rip-off|never again|lawsuit|stole|lied|denied|useless)/i.test(
      blob,
    );
  const pos =
    /(great|amazing|thank|thanks|awesome|love|helpful|recommend|excellent|fast|smooth|appreciate)/i.test(
      blob,
    );
  if (neg && !pos) return 'negative';
  if (pos && !neg) return 'positive';
  return 'neutral';
}

function firstLine(text: string): string {
  return text.split(/\n/).map((l) => l.trim()).find(Boolean) || '';
}

export function textSimilarity(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  const A = tok(a);
  const B = tok(b);
  if (!A.size || !B.size) return a.trim() === b.trim() ? 1 : 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

/** Strip first-person singular the model sometimes sneaks in. */
function enforceWeVoice(text: string): string {
  let t = text.trim();
  // Common "I" patterns → we/us
  const replacements: Array<[RegExp, string]> = [
    [/\bI'm\b/gi, "we're"],
    [/\bI’ve\b/gi, "we've"],
    [/\bI'd\b/gi, "we'd"],
    [/\bI'll\b/gi, "we'll"],
    [/\bI am\b/gi, 'we are'],
    [/\bI was\b/gi, 'we were'],
    [/\bI have\b/gi, 'we have'],
    [/\bI had\b/gi, 'we had'],
    [/\bI can\b/gi, 'we can'],
    [/\bI will\b/gi, 'we will'],
    [/\bI promise\b/gi, 'we promise'],
    [/\bmy bad\b/gi, 'our bad'],
    [/\bDM me\b/gi, 'DM us'],
    [/\bmessage me\b/gi, 'message us'],
    [/\bping me\b/gi, 'ping us'],
    [/\bcontact me\b/gi, 'contact us'],
    [/\breach out to me\b/gi, 'reach out to us'],
    // leftover bare "I " at start of sentence / mid
    [/(^|[.!?]\s+)I\s+/g, '$1We '],
    [/\bI\s+/g, 'we '],
  ];
  for (const [re, to] of replacements) {
    t = t.replace(re, to);
  }
  // Fix doubled casing issues from "we We"
  t = t.replace(/\bwe We\b/g, 'We');
  t = t.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/** Remove deflecting "we can't help here" language the model sometimes adds. */
function stripPublicThreadDeflections(text: string): string {
  let t = text;
  const bad = [
    /\s*We can't (handle|fix|sort|access|pull up|see)[^.!?\n]*\./gi,
    /\s*We cannot (handle|fix|sort|access)[^.!?\n]*\./gi,
    /\s*We don't have (claim|account|full)[^.!?\n]*\./gi,
    /\s*We do not have (claim|account|full)[^.!?\n]*\./gi,
    /\s*[^.!?\n]*(public thread|here on Reddit|from Reddit|in this thread)[^.!?\n]*\./gi,
    /\s*Nobody outside the claims team[^.!?\n]*\./gi,
    /\s*account-specific[^.!?\n]*\./gi,
  ];
  for (const re of bad) t = t.replace(re, ' ');
  return t.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function ensureHelpCta(content: string, sentiment: 'positive' | 'negative' | 'neutral'): string {
  let out = content.trim();
  const hasPortal = /protect\.likewize\.com/i.test(out);
  const hasDm = /\b(dm|direct message|message us|reach out)\b/i.test(out);

  if (sentiment === 'positive') {
    if (!hasPortal) out += `\n\nAnytime you need us: ${PORTAL} — or DM us.`;
    return out;
  }

  if (!hasPortal || !hasDm) {
    out += `\n\nPlease leave us a DM or reach out at ${PORTAL} — we want to fully help, and we'll make sure you're taken care of.`;
  } else if (!/taken care of|make sure|make this right|get this sorted/i.test(out)) {
    out += ` We'll make sure you're taken care of.`;
  }
  return out;
}

function finalizeReply(content: string, sentiment: 'positive' | 'negative' | 'neutral'): string {
  let t = stripModelNoise(content);
  t = enforceWeVoice(t);
  t = stripPublicThreadDeflections(t);
  t = ensureHelpCta(t, sentiment);
  return t.trim();
}

function stripModelNoise(content: string): string {
  return content
    .replace(/^```[\w]*\n?/, '')
    .replace(/\n?```$/, '')
    .replace(/^(Sentiment|Analysis|Tone|Draft|Reply|Rewritten)\s*:\s*.+\n+/i, '')
    .trim();
}

function pickDistinct<T>(options: T[], previous: string | null | undefined, toText: (x: T) => string): T {
  if (!options.length) throw new Error('no options');
  const prev = clean(previous);
  const shuffled = [...options].sort(() => Math.random() - 0.5);
  if (!prev) return shuffled[0]!;
  for (const opt of shuffled) {
    if (textSimilarity(toText(opt), prev) < 0.55) return opt;
  }
  for (const opt of shuffled) {
    if (firstLine(toText(opt)).toLowerCase() !== firstLine(prev).toLowerCase()) return opt;
  }
  return shuffled[Math.floor(Math.random() * shuffled.length)]!;
}

type TemplateParts = { body: string };

/** Offline templates — we/us only, sorry + help + DM/portal. */
function draftReplyTemplate(input: DraftReplyInput): DraftReplyResult {
  const sentiment = resolveSentiment(input);
  const client = clean(input.client);
  const clientBit = client ? ` (${client})` : '';

  // One casual hook from their issue (not a full rehash)
  const blob = clean(input.text || input.title).toLowerCase();
  let issueCue = 'what happened';
  if (/track|ups|ship|fedex/.test(blob)) issueCue = 'the tracking / shipping situation';
  else if (/claim|denied|reject/.test(blob)) issueCue = 'the claim situation';
  else if (/repair|replace|replacement/.test(blob)) issueCue = 'the repair/replacement delay';
  else if (/wait|delay|slow|week|month/.test(blob)) issueCue = 'how long this has dragged on';
  else if (/cancel|refund|charge/.test(blob)) issueCue = 'the billing / cancel issue';

  let options: TemplateParts[] = [];

  if (sentiment === 'positive') {
    options = [
      {
        body: `That's great to hear! Appreciate you sharing this${clientBit}.\n\nIf you ever need us again, DM us or visit ${PORTAL}.`,
      },
      {
        body: `Thanks for the kind words — means a lot.\n\nGlad things worked out. Anytime: DM us or ${PORTAL}.`,
      },
      {
        body: `Appreciate the update! Happy it went smoothly${clientBit}.\n\nWe're here if you need anything — DM us or ${PORTAL}.`,
      },
    ];
  } else if (sentiment === 'negative') {
    options = [
      {
        body: `Hey there — we're really sorry about ${issueCue}${clientBit}. That's not okay, and we want to fully help you get this sorted.\n\nPlease leave us a DM or reach out at ${PORTAL} and we'll make sure you're taken care of.`,
      },
      {
        body: `Sorry this happened with ${issueCue}. We hear you, and we want to help make it right.\n\nDM us or hop over to ${PORTAL} — our team will take care of you.`,
      },
      {
        body: `Hey — sorry you've been dealing with ${issueCue}${clientBit}. We don't want you stuck with this.\n\nReach out on ${PORTAL} or send us a DM and we'll make sure this gets handled.`,
      },
      {
        body: `We're sorry about ${issueCue}. We want to fully support you and get this fixed.\n\nPlease DM us or visit ${PORTAL} — we'll make sure you're taken care of.`,
      },
      {
        body: `Ugh, sorry about ${issueCue}${clientBit}. We want to help end to end.\n\nLeave a DM or reach out at ${PORTAL} and we'll take care of this for you.`,
      },
    ];
  } else {
    options = [
      {
        body: `Hey there — thanks for writing this up${clientBit}. If anything needs fixing, we want to help.\n\nDM us or reach out at ${PORTAL} and we'll make sure you're taken care of.`,
      },
      {
        body: `Appreciate the details. Happy to help get this sorted — leave us a DM or visit ${PORTAL} and we'll take care of you.`,
      },
    ];
  }

  const chosen = pickDistinct(options, input.previousReply, (o) => o.body);
  return {
    reply: finalizeReply(chosen.body, sentiment),
    provider: 'template',
    portalUrl: PORTAL,
    mode: 'generate',
    warning:
      'Grok API unavailable (check XAI_API_KEY / model). Used an offline template instead — regenerate still rotates different templates.',
  };
}

function rewriteTemplate(userDraft: string, input: DraftReplyInput): DraftReplyResult {
  const sentiment = resolveSentiment(input);
  let reply = enforceWeVoice(userDraft.trim());
  if (!/[.!?]$/.test(reply)) reply = `${reply}.`;
  reply = finalizeReply(reply, sentiment);
  return {
    reply,
    provider: 'template',
    portalUrl: PORTAL,
    mode: 'rewrite',
    warning: 'Grok API unavailable — light local polish only.',
  };
}

const CORE_VOICE = `You write short public comments for Likewize (device protection).

STRUCTURE (negative / problem posts):
1) We're sorry this happened — warm, human, brief
2) We want to fully help them get this sorted
3) Invite: leave a DM **or** reach out on the website ${PORTAL}
4) Reassure: we'll make sure they're taken care of

STRUCTURE (positive posts):
- Thank them, appreciate them, soft DM/portal if useful

TONE:
- Casual, polished, caring — not stiff corporate
- About 45–100 words, 2–4 short sentences
- Light nod at the issue only — do not rehash the whole rant
- Never invent claim numbers, refunds, free devices, or legal admissions

VOICE — CRITICAL:
- ONLY "we" / "us" / "our" (Likewize as a team)
- NEVER "I", "I'm", "I'll", "I'd", "me", "my"
- Say "DM us" not "DM me"

FORBIDDEN (never write these or anything similar):
- "We can't handle full claim details in a public thread"
- "We don't have access on Reddit" / "from here"
- "We can't fix this here"
- "Account-specific" / call-center script talk

${STYLE_EXAMPLES}

Output ONLY the comment text. No labels, no markdown fences.`;

function buildSystemPrompt(
  sentiment: 'positive' | 'negative' | 'neutral',
  opts: { regenerate: boolean; angle: string; banFirstLine?: string },
): string {
  const regen = opts.regenerate
    ? `\n\nREGENERATE: different wording from the previous draft. Angle: ${opts.angle}${
        opts.banFirstLine ? `\nDo not open with: "${opts.banFirstLine}"` : ''
      }`
    : '';

  if (sentiment === 'positive') {
    return `${CORE_VOICE}${regen}

POSITIVE: thank them, appreciate their trust, soft DM or ${PORTAL}.`;
  }
  if (sentiment === 'negative') {
    return `${CORE_VOICE}${regen}

NEGATIVE:
- We're sorry this happened (light mention of their issue: tracking, claim, delay, etc.)
- We want to fully help them
- DM us OR ${PORTAL}
- We'll make sure they're taken care of
Be warm and inviting — never defensive, never "we can't help in this thread".`;
  }
  return `${CORE_VOICE}${regen}

NEUTRAL: brief, helpful, DM or ${PORTAL}, we'll take care of them if something's wrong.`;
}

const REGEN_ANGLES = [
  'Slightly shorter and warmer.',
  'Open with "Hey there — we\'re really sorry…".',
  'Lead with "Sorry this happened…".',
  'Stronger "we want to fully help you" line.',
  'Emphasize DM or website, then reassurance.',
  'Very polished, minimal — 3 sentences.',
] as const;

async function callXai(
  messages: Array<{ role: string; content: string }>,
  temperature: number,
): Promise<{ content: string | null; error?: string }> {
  const apiKey = (process.env.XAI_API_KEY || process.env.GROK_API_KEY || '').trim();
  if (!apiKey) return { content: null, error: 'XAI_API_KEY is not set' };

  const model = (process.env.XAI_MODEL || 'grok-4-1-fast').trim();

  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: 280,
        messages,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[draftReply] xAI error', res.status, errText.slice(0, 400));
      let msg = `xAI ${res.status}`;
      try {
        const j = JSON.parse(errText) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        if (errText) msg = errText.slice(0, 160);
      }
      return { content: null, error: msg };
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim() || '';
    return { content: content ? stripModelNoise(content) : null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[draftReply] xAI exception', msg);
    return { content: null, error: msg };
  }
}

async function draftWithXai(
  input: DraftReplyInput,
  sentiment: 'positive' | 'negative' | 'neutral',
): Promise<{ reply: string | null; error?: string }> {
  const n = typeof input.variation === 'number' ? Math.max(0, input.variation) : 0;
  const previous = clean(input.previousReply);
  const regenerate = n > 0 || !!previous;
  const angle = REGEN_ANGLES[(n + Math.floor(Math.random() * REGEN_ANGLES.length)) % REGEN_ANGLES.length]!;
  const banFirst = previous ? firstLine(previous).slice(0, 120) : undefined;
  const system = buildSystemPrompt(sentiment, { regenerate, angle, banFirstLine: banFirst });
  const nonce = clean(input.nonce) || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const avoidBlock = previous
    ? `\n\nPREVIOUS (write different wording):\n---\n${previous.slice(0, 1200)}\n---`
    : '';

  const user = `Write a short Likewize community comment (${sentiment}).
Nonce: ${nonce} | variation ${n} | ${angle}
${avoidBlock}

Author: ${input.author || 'unknown'}
Client: ${input.client || 'n/a'}
Source: ${input.source || 'n/a'}
Subreddit: ${input.subreddit || 'n/a'}
Portal: ${PORTAL}

Title: ${input.title || '(none)'}

Post:
${(input.text || '').slice(0, 3500)}

Rules: we/us only (no I/me/my). Sorry it happened, we want to fully help, DM or ${PORTAL}, we'll take care of them. Never say we can't help in a public thread.`;

  const temperature = regenerate ? 0.9 : 0.55;

  const { content, error } = await callXai(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
  );
  if (!content) return { reply: null, error };

  let reply = finalizeReply(content, sentiment);

  if (previous && textSimilarity(reply, previous) >= 0.65) {
    const retry = await callXai(
      [
        {
          role: 'system',
          content: `${CORE_VOICE}\nWrite a NEW short comment. Different opening. we/us only. Include ${PORTAL}.`,
        },
        {
          role: 'user',
          content: `Rejected:\n${previous.slice(0, 800)}\n\nPost:\n${(input.text || '').slice(0, 1500)}\nNonce ${nonce}-r`,
        },
      ],
      0.95,
    );
    if (retry.content && textSimilarity(retry.content, previous) < textSimilarity(reply, previous)) {
      reply = finalizeReply(retry.content, sentiment);
    }
  }

  return { reply, error };
}

async function rewriteWithXai(
  input: DraftReplyInput,
  userDraft: string,
  sentiment: 'positive' | 'negative' | 'neutral',
): Promise<{ reply: string | null; error?: string }> {
  const system = `${CORE_VOICE}

Rewrite the user's draft into this style. Keep intent. we/us only — strip every I/me/my. Short. Portal ${PORTAL} if missing.`;

  const user = `Rewrite this draft.

Sentiment: ${sentiment}
Post excerpt: ${(input.text || '').slice(0, 1500)}

Draft:
---
${userDraft.slice(0, 2500)}
---
Portal: ${PORTAL}`;

  const { content, error } = await callXai(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    0.5,
  );
  if (!content) return { reply: null, error };
  return { reply: finalizeReply(content, sentiment), error };
}

export async function generateDraftReply(input: DraftReplyInput): Promise<DraftReplyResult> {
  const mode: DraftReplyMode = input.mode === 'rewrite' ? 'rewrite' : 'generate';
  const text = clean(input.text) || clean(input.title);
  const draftText = clean(input.draftText);

  if (mode === 'rewrite') {
    if (!draftText) {
      return { reply: '', provider: 'template', portalUrl: PORTAL, mode: 'rewrite' };
    }
    const normalized: DraftReplyInput = {
      ...input,
      text: (input.text || input.title || '').slice(0, 8000),
      title: input.title || null,
      draftText,
      nonce: input.nonce || `${Date.now()}-rw`,
    };
    const sentiment = resolveSentiment(normalized);
    const llm = await rewriteWithXai(normalized, draftText, sentiment);
    if (llm.reply) {
      return { reply: llm.reply, provider: 'xai', portalUrl: PORTAL, mode: 'rewrite' };
    }
    const fallback = rewriteTemplate(draftText, normalized);
    return { ...fallback, warning: llm.error || fallback.warning };
  }

  if (!text) {
    return { reply: '', provider: 'template', portalUrl: PORTAL, mode: 'generate' };
  }

  const normalized: DraftReplyInput = {
    ...input,
    text: (input.text || input.title || '').slice(0, 8000),
    title: input.title || null,
    nonce: input.nonce || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };

  const sentiment = resolveSentiment(normalized);
  const llm = await draftWithXai(normalized, sentiment);

  if (llm.reply) {
    const prev = clean(input.previousReply);
    if (prev && (llm.reply === prev || textSimilarity(llm.reply, prev) >= 0.75)) {
      return {
        ...draftReplyTemplate({ ...normalized, previousReply: prev }),
        warning: 'Grok returned a near-duplicate; used a different offline template.',
      };
    }
    return { reply: llm.reply, provider: 'xai', portalUrl: PORTAL, mode: 'generate' };
  }

  return {
    ...draftReplyTemplate(normalized),
    warning: llm.error
      ? `Grok unavailable (${llm.error}). Rotating offline templates instead.`
      : undefined,
  };
}
