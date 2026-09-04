/**
 * One-off: pull Boost Mobile Reddit (Boost Protect / Likewize DP) into Supabase.
 *   npx tsx --env-file=.env.local scripts/ingest-boost-mobile.ts
 */
import { fetchBoostMobileMentions } from '@/lib/reddit';
import { classifyWithGrok } from '@/lib/classify';
import { supabaseAdmin } from '@/lib/supabase';
import { hasBoostLikewizeClaimSignal, normalizeMentionSource } from '@/lib/utils';

async function main() {
  if (!supabaseAdmin) {
    console.error('Supabase admin client missing — check SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const { data: existing } = await supabaseAdmin
    .from('mentions')
    .select('reddit_id, content, title, subreddit, retailer, raw_data')
    .or('retailer.ilike.%boost%,subreddit.ilike.%boost%');

  let removed = 0;
  for (const row of existing || []) {
    const hay = `${row.content || ''} ${row.title || ''} ${row.subreddit || ''} ${row.retailer || ''}`;
    if (hasBoostLikewizeClaimSignal(hay)) continue;
    const { error } = await supabaseAdmin.from('mentions').delete().eq('reddit_id', row.reddit_id);
    if (!error) removed++;
  }
  console.log(`[Boost ingest] Removed ${removed} Boost rows that were not Likewize/claim`);

  console.log('[Boost ingest] Fetching Reddit (Likewize or claim only)…');
  const raws = await fetchBoostMobileMentions({ time: 'all' });
  console.log(`[Boost ingest] ${raws.length} mentions to classify + upsert`);

  let upserted = 0;
  let skipped = 0;
  for (const raw of raws) {
    const haystack = `${raw.text || ''} ${raw.title || ''}`;
    if (!hasBoostLikewizeClaimSignal(haystack)) {
      skipped++;
      continue;
    }

    let classification;
    try {
      classification = await classifyWithGrok(raw.text, raw.client);
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
      retailer: raw.client || 'Boost Mobile',
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
        client: raw.client || 'Boost Mobile',
        retailer_context: raw.client || 'Boost Mobile',
        full_thread: raw.full_thread,
        comments: raw.comments || [],
        product_type: 'electronic_device_protection',
        original: raw,
      },
    };

    const { error } = await supabaseAdmin.from('mentions').upsert(dbRow, { onConflict: 'reddit_id' });
    if (error) {
      console.error(`[Boost ingest] upsert failed ${raw.id}:`, error.message);
    } else {
      upserted++;
      console.log(`[Boost ingest] ${upserted}/${raws.length} ${raw.id} · ${(raw.title || raw.text || '').slice(0, 70)}`);
    }
  }

  console.log(`[Boost ingest] Done. upserted=${upserted} skipped=${skipped} fetched=${raws.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
