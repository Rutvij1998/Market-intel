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
}

// Classification is now **Hugging Face (for sentiment) + rule-based only** (no Gemini / xAI).
// HF provides reliable positive/neutral/negative for the text.
// Rule-based handles pillar, company detection (Likewize / Asurion / Allstate / SquareTrade),
// is_relevant, and the strict electronic device protection filter.
// This ensures consistent competitor tagging (Asurion, Allstate) without depending on external LLM JSON.
export async function classifyWithGrok(text: string, client?: string): Promise<{ 
  sentiment: SentimentType; 
  pillar: Pillar; 
  confidence: number; 
  key_issue?: string | null;
  company?: 'Likewize' | 'Asurion' | 'Allstate' | 'SquareTrade' | 'Other';
  product_type?: 'electronic_device_protection' | 'other';
  is_relevant?: boolean;
}> {
  const hfKeyPresent = !!process.env.HUGGINGFACE_API_KEY;
  console.log('[Classify] Using Hugging Face + rule-based only (HF key present:', hfKeyPresent, ')');
  return await hfOrRuleBased(text);
}

// Hugging Face fallback for sentiment (if Gemini unavailable)
// Uses a pre-trained model for positive/neutral/negative on general text
async function getHuggingFaceSentiment(text: string): Promise<{sentiment: SentimentType, confidence: number} | null> {
  const hfKey = process.env.HUGGINGFACE_API_KEY;
  if (!hfKey) {
    return null;
  }
  try {
    const response = await fetch(
      'https://api-inference.huggingface.co/models/cardiffnlp/twitter-roberta-base-sentiment-latest',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hfKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: text.substring(0, 500) }),
      }
    );
    if (!response.ok) {
      console.error('[Classify] HF API error:', response.status);
      return null;
    }
    const result = await response.json();
    if (!Array.isArray(result) || !result[0]) return null;
    const labels = result[0];
    const topLabel = labels.reduce((prev: any, curr: any) => (prev.score > curr.score ? prev : curr));
    let sentiment: SentimentType = 'neutral';
    const label = topLabel.label.toLowerCase();
    if (label === 'positive') sentiment = 'positive';
    else if (label === 'negative') sentiment = 'negative';
    return { sentiment, confidence: topLabel.score };
  } catch (err) {
    console.error('[Classify] HF fallback error:', err);
    return null;
  }
}

async function hfOrRuleBased(text: string) {
  const hfResult = await getHuggingFaceSentiment(text);
  const ruleResult = ruleBasedClassification(text);
  if (hfResult) {
    console.log(`[Classify] HF sentiment success: ${hfResult.sentiment} (conf ${hfResult.confidence.toFixed(2)})`);
    return {
      ...ruleResult,
      sentiment: hfResult.sentiment,
      confidence: hfResult.confidence,
    };
  }
  return ruleResult;
}

// (Gemini / LLM path removed per request — classification is HF sentiment + deterministic rule-based only for reliability on competitors.)

function ruleBasedClassification(text: string): any {
  const lower = text.toLowerCase();

  // Apply strict device protection filter first (symmetric for Likewize + competitors)
  const relevant = /likewize|asurion|squaretrade|allstate|phone protection|device protection|"protection plan".*(phone|device)|phone insurance|phone warranty|screen protection plan/i.test(lower) &&
                   !/(health|medical|auto|car|vehicle|home|pet|travel|life insurance)/i.test(lower);

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
  if (/(great|fast|happy|excellent|love|quick|easy|good experience|worked perfectly)/.test(lower)) sentiment = 'positive';
  if (/(bad|slow|denied|frustrat|terrible|transferred|wait|issue|problem|scam|worst|delayed|no resolution)/.test(lower)) sentiment = 'negative';

  let pillar: Pillar = 'Other';
  if (/(claim|claims|denied|approval)/.test(lower)) pillar = 'Claims';
  else if (/(repair|repaired|fix|screen)/.test(lower)) pillar = 'Repair';
  else if (/(replace|replacement|new phone)/.test(lower)) pillar = 'Replacement';
  else if (/(reimburse|refund|money|payment)/.test(lower)) pillar = 'Reimbursements';
  else if (/(call|support|phone|transferred|wait time|customer service)/.test(lower)) pillar = 'Customer Service';

  const confidence = sentiment === 'neutral' ? 0.55 : 0.78;

  const company = /likewize|like wize/i.test(lower) ? 'Likewize' :
                  /asurion/i.test(lower) ? 'Asurion' :
                  /allstate|all state/i.test(lower) ? 'Allstate' :
                  /squaretrade|square trade/i.test(lower) ? 'SquareTrade' : 'Other';

  return { 
    sentiment, 
    pillar, 
    confidence, 
    key_issue: undefined,
    company,
    product_type: 'electronic_device_protection',
    is_relevant: true 
  };
}
