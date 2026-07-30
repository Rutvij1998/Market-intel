import { z } from 'zod';

export const Pillars = ['Claims', 'Repair', 'Replacement', 'Customer Service', 'Reimbursements', 'Call Center', 'Other'] as const;
export type Pillar = typeof Pillars[number];

export const Sentiment = ['positive', 'neutral', 'negative'] as const;
export type SentimentType = typeof Sentiment[number];

const ClassificationSchema = z.object({
  sentiment: z.enum(Sentiment),
  pillar: z.enum(Pillars),
  confidence: z.number().min(0).max(1),
  key_issue: z.string().nullish(),
  // New for competitor + strict device protection focus
  company: z.enum(['Likewize', 'Asurion', 'Allstate', 'SquareTrade', 'Other']).nullish(),
  product_type: z.enum(['electronic_device_protection', 'other']).nullish(),
  is_relevant: z.boolean().nullish(),
});

export type BusinessLine = 'DP' | 'HomeTech' | 'TradeIn' | 'Shipping' | 'CallCenter' | 'Other';

export interface ClassifiedMention {
  id: string;
  text: string;
  source: string;
  url: string;
  created_at: string;
  sentiment: SentimentType;
  pillar: Pillar;
  confidence: number;
  key_issue?: string | null;
  client?: string;   // retailer the plan was bought through (Newegg, Rogers, etc.)
  subreddit?: string;
  title?: string;
  rating?: number | null;
  // Competitor analysis fields
  company?: 'Likewize' | 'Asurion' | 'Allstate' | 'SquareTrade' | 'Other';
  product_type?: 'electronic_device_protection' | 'other';
  is_relevant?: boolean;
  full_thread?: string;
  comments?: Array<{ author?: string; body?: string; created_utc?: number }>;
  has_official_reply?: boolean;
  first_official_reply_hours?: number | null;
  official_replier?: string | null;
  /** Likewize business line only (DP / HomeTech / TradeIn / Other). Not used for competitors. */
  business_line?: BusinessLine;
}

// Classification: Hugging Face ONLY for sentiment + rule-based pillar/company.
// No Gemini / xAI. Old host api-inference.huggingface.co is dead — use router.huggingface.co.
// If HF is unreachable / 401 / 403, circuit-break and use rules for the rest of the run.

/** Skip further HF calls after a hard failure (auth/DNS/network). */
let hfDisabledReason: string | null = null;
let hfLoggedStatus = false;
let hfSuccessLogged = false;

function getHfApiKey(): string | null {
  const key = (process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || '').trim();
  return key || null;
}

export async function classifyWithGrok(text: string, client?: string): Promise<{
  sentiment: SentimentType;
  pillar: Pillar;
  confidence: number;
  key_issue?: string | null;
  company?: 'Likewize' | 'Asurion' | 'Allstate' | 'SquareTrade' | 'Other';
  product_type?: 'electronic_device_protection' | 'other';
  is_relevant?: boolean;
}> {
  if (!hfLoggedStatus) {
    hfLoggedStatus = true;
    const key = getHfApiKey();
    console.log(
      `[Classify] Hugging Face only (no Gemini). Key present: ${!!key}${key ? ` (${key.slice(0, 6)}…)` : ''}`,
    );
    if (!key) {
      console.warn(
        '[Classify] Missing HUGGINGFACE_API_KEY. Using rule-based sentiment until you set one.',
      );
    }
  }
  return await hfOrRuleBased(text);
}

// HF Inference Providers (replacement for deprecated api-inference.huggingface.co)
const HF_MODEL = 'cardiffnlp/twitter-roberta-base-sentiment-latest';
const HF_SENTIMENT_URL = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`;

async function getHuggingFaceSentiment(
  text: string,
): Promise<{ sentiment: SentimentType; confidence: number } | null> {
  if (hfDisabledReason) return null;

  const hfKey = getHfApiKey();
  if (!hfKey) {
    hfDisabledReason = 'no HUGGINGFACE_API_KEY';
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(HF_SENTIMENT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hfKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: text.substring(0, 500) }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.status === 401 || response.status === 403) {
      const body = await response.text().catch(() => '');
      hfDisabledReason = `HF auth/permission error HTTP ${response.status}`;
      console.warn(
        `[Classify] ${hfDisabledReason}. Your token cannot call Inference Providers.\n` +
          '  Fix: https://huggingface.co/settings/tokens → create a Fine-grained token →\n' +
          '  enable "Make calls to the Inference Providers" → put it in HUGGINGFACE_API_KEY → restart.\n' +
          '  Falling back to rule-based sentiment for this process.',
      );
      if (body) console.warn('[Classify] HF response:', body.slice(0, 200));
      return null;
    }

    // Model cold-start
    if (response.status === 503) {
      console.warn('[Classify] HF model loading (503); will retry on next mention.');
      return null;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(`[Classify] HF API error: ${response.status}`, body.slice(0, 200));
      // Don't circuit-break on transient 5xx except we already handled 503
      if (response.status >= 500) return null;
      hfDisabledReason = `HF HTTP ${response.status}`;
      return null;
    }

    const result = await response.json();
    // Shape: [[{label, score}, ...]] or [{label, score}, ...]
    const labels = Array.isArray(result?.[0]) ? result[0] : Array.isArray(result) ? result : null;
    if (!labels?.length) {
      console.warn('[Classify] HF returned unexpected payload:', JSON.stringify(result).slice(0, 200));
      return null;
    }

    const topLabel = labels.reduce((prev: any, curr: any) =>
      prev.score > curr.score ? prev : curr,
    );
    let sentiment: SentimentType = 'neutral';
    const label = String(topLabel.label || '').toLowerCase();
    if (label.includes('positive') || label === 'label_2') sentiment = 'positive';
    else if (label.includes('negative') || label === 'label_0') sentiment = 'negative';
    else sentiment = 'neutral';

    if (!hfSuccessLogged) {
      hfSuccessLogged = true;
      console.log(`[Classify] HF sentiment OK via ${HF_MODEL}`);
    }

    return { sentiment, confidence: Number(topLabel.score) || 0.6 };
  } catch (err: any) {
    const msg = err?.cause?.code || err?.code || err?.message || String(err);
    if (
      /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|abort/i.test(String(msg)) ||
      err?.name === 'AbortError'
    ) {
      hfDisabledReason = `HF unreachable (${msg})`;
      console.warn(
        `[Classify] ${hfDisabledReason}. Disabling HF for this process; using rule-based sentiment.`,
      );
      return null;
    }
    console.warn('[Classify] HF request failed:', msg);
    return null;
  }
}

async function hfOrRuleBased(text: string) {
  const hfResult = await getHuggingFaceSentiment(text);
  const ruleResult = ruleBasedClassification(text);
  if (hfResult) {
    return {
      ...ruleResult,
      sentiment: hfResult.sentiment,
      confidence: hfResult.confidence,
    };
  }
  return ruleResult;
}

function ruleBasedClassification(text: string): any {
  const lower = text.toLowerCase();

  const excludedCategory =
    /(health insurance|medical|auto insurance|car insurance|vehicle insurance|home insurance|pet insurance|travel insurance|life insurance)\b/i.test(
      lower,
    );

  // Company brand OR device-protection language (PC reviews often omit the brand name)
  const mentionsCompany = /likewize|like wize|asurion|squaretrade|square trade|allstate/i.test(lower);
  const mentionsDeviceProtection =
    /phone protection|device protection|protection plan|phone insurance|phone warranty|screen protection|gadget protection|cracked screen|broken phone|phone claim|device claim|replacement phone|phone replacement|claim was denied|insurance claim/i.test(
      lower,
    ) ||
    (/\b(iphone|android|samsung|pixel|phone|tablet|laptop)\b/i.test(lower) &&
      /\b(claim|repair|replace|replacement|warranty|insurance|coverage|deductible|refund)\b/i.test(lower));

  const relevant = !excludedCategory && (mentionsCompany || mentionsDeviceProtection);

  if (!relevant) {
    return {
      sentiment: 'neutral',
      pillar: 'Other',
      confidence: 0.2,
      key_issue: 'Non-electronic or excluded category',
      company: 'Other',
      product_type: 'other',
      is_relevant: false,
    };
  }

  let sentiment: SentimentType = 'neutral';
  const positiveHits =
    (lower.match(
      /\b(great|fast|happy|excellent|love|quick|easy|good experience|worked perfectly|resolved|helpful|thank you|recommend)\b/g,
    ) || []).length;
  const negativeHits =
    (lower.match(
      /\b(bad|slow|denied|frustrat\w*|terrible|awful|horrible|transferred|wait(?:ing|ed)?|issue|problem|scam|worst|delayed|no resolution|refuse|refused|never received|still waiting|ripoff|rip-off|complaint|cancel|lawsuit|fraud|useless|unhelpful|no response|ignore[d]?|lost my|stolen|broken promise)\b/g,
    ) || []).length;

  if (negativeHits > positiveHits) sentiment = 'negative';
  else if (positiveHits > negativeHits) sentiment = 'positive';
  // Complaint-style language without soft positive words → negative
  else if (
    /(will not|won't|didn't|did not|never got|still have not|have not received|no phone|no refund|deny|denial|refuse|refused|still waiting)/i.test(
      lower,
    )
  ) {
    sentiment = 'negative';
  }

  let pillar: Pillar = 'Other';
  if (/(claim|claims|denied|approval|deny|denial)/.test(lower)) pillar = 'Claims';
  else if (/(repair|repaired|fix|screen crack)/.test(lower)) pillar = 'Repair';
  else if (/(replace|replacement|new phone|loaner)/.test(lower)) pillar = 'Replacement';
  else if (/(reimburse|refund|money back|payment|charge[d]?)/.test(lower)) pillar = 'Reimbursements';
  else if (/(call center|phone tree|ivr)/.test(lower)) pillar = 'Call Center';
  else if (/(call|support|customer service|agent|representative|transferred|wait time|hold)/.test(lower))
    pillar = 'Customer Service';

  const confidence = sentiment === 'neutral' ? 0.55 : 0.78;

  const company = /likewize|like wize/i.test(lower)
    ? 'Likewize'
    : /asurion/i.test(lower)
      ? 'Asurion'
      : /allstate|all state/i.test(lower)
        ? 'Allstate'
        : /squaretrade|square trade/i.test(lower)
          ? 'SquareTrade'
          : 'Other';

  return {
    sentiment,
    pillar,
    confidence,
    key_issue: undefined,
    company,
    product_type: 'electronic_device_protection',
    is_relevant: true,
  };
}
