/**
 * One-off: pull Samsung GTP / Galaxy Likewize Reddit into Supabase.
 *   npx tsx --env-file=.env.local scripts/ingest-samsung-gtp.ts
 */
import { fetchSamsungGtpMentions } from '@/lib/reddit';
import { classifyWithGrok } from '@/lib/classify';
import { supabaseAdmin } from '@/lib/supabase';
import { isLikewizeRelevant, normalizeMentionSource } from '@/lib/utils';

async function main() {
  if (!supabaseAdmin) {
    console.error('Supabase admin client missing — check SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  console.log('[Samsung GTP] Fetching Reddit (Likewize required)…');
  const raws = await fetchSamsungGtpMentions({ time: 'all' });
  console.log(`[Samsung GTP] ${raws.length} mentions to classify + upsert`);

  let upserted = 0;
  let skipped = 0;
  for (const raw of raws) {
    const haystack = `${raw.text || ''} ${raw.title || ''}`;
    if (!isLikewizeRelevant({ text: haystack })) {
      skipped++;
      continue;
    }

    let classification;
    try {
      classification = await classifyWithGrok(raw.text, raw.client || 'Samsung');
    } catch {
      classification = {
        sentiment: 'neutral' as const,
        pillar: 'Other' as const,
        confidence: 0.4,
        key_issue: 'Classification error',
      };
    }

    const dbRow = {
      source: normalizeMentionSource(raw.source, { url: raw.url, id: raw.id }),
      retailer: raw.client || 'Samsung',
      subreddit: raw.subreddit,
      title: raw.title,
      content: raw.text,
      url: raw.url,
      author: raw.author,
      reddit_id: raw.id,
      created_at: raw.created_at,
      sentiment: classification.sentiment,
      pillar: classification.pillar,
      confidence: classification.confidence,
      raw_data: {
        reddit_id: raw.id,
        source: raw.source,
        company: 'Likewize',
        competitor: 'Likewize',
        client: raw.client || 'Samsung',
        retailer_context: raw.client || 'Samsung',
        full_thread: raw.full_thread,
        comments: raw.comments || [],
        product_type: 'electronic_device_protection',
        original: raw,
      },
    };

    const { error } = await supabaseAdmin.from('mentions').upsert(dbRow, { onConflict: 'reddit_id' });
    if (error) {
      console.error(`[Samsung GTP] upsert failed ${raw.id}:`, error.message);
    } else {
      upserted++;
      console.log(
        `[Samsung GTP] ${upserted}/${raws.length} ${raw.id} · r/${raw.subreddit} · ${(raw.title || raw.text || '').slice(0, 80)}`,
      );
    }
  }

  console.log(`[Samsung GTP] Done. upserted=${upserted} skipped=${skipped} fetched=${raws.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
