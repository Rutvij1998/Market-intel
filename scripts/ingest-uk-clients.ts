/**
 * One-off: Barclays + NatWest (Likewize, all hits),
 * VMO2 device trade-in + Likewize, Samsung device trade-in + Likewize.
 *
 *   npx tsx --env-file=.env.local scripts/ingest-uk-clients.ts
 */
import {
  fetchBarclaysLikewizeMentions,
  fetchNatwestLikewizeMentions,
  fetchVmo2TradeInMentions,
  fetchSamsungTradeInMentions,
  type RawMention,
} from '@/lib/reddit';
import { classifyWithGrok } from '@/lib/classify';
import { supabaseAdmin } from '@/lib/supabase';
import {
  isLikewizeBrand,
  isNatwestContext,
  isO2RecycleDeviceContext,
  isSamsungTradeInDeviceContext,
  normalizeMentionSource,
} from '@/lib/utils';

async function upsertBatch(
  label: string,
  defaultClient: string,
  raws: RawMention[],
  keep: (hay: string, m: RawMention) => boolean,
) {
  let upserted = 0;
  let skipped = 0;

  for (const raw of raws) {
    const haystack = `${raw.text || ''} ${raw.title || ''} ${raw.full_thread || ''}`;
    if (!keep(haystack, raw)) {
      skipped++;
      continue;
    }

    let classification;
    try {
      classification = await classifyWithGrok(raw.text, raw.client || defaultClient);
    } catch {
      classification = {
        sentiment: 'neutral' as const,
        pillar: 'Other' as const,
        confidence: 0.4,
        key_issue: 'Classification error',
      };
    }

    const client = raw.client || defaultClient;
    const dbRow = {
      source: normalizeMentionSource(raw.source, { url: raw.url, id: raw.id }),
      retailer: client,
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
        client,
        retailer_context: client,
        full_thread: raw.full_thread,
        comments: raw.comments || [],
        product_type: 'electronic_device_protection',
        original: raw,
      },
    };

    const { error } = await supabaseAdmin!.from('mentions').upsert(dbRow, { onConflict: 'reddit_id' });
    if (error) {
      console.error(`[${label}] upsert failed ${raw.id}:`, error.message);
    } else {
      upserted++;
      console.log(
        `[${label}] ${upserted}/${raws.length} ${raw.id} · r/${raw.subreddit || '?'} · ${(raw.title || raw.text || '').slice(0, 80)}`,
      );
    }
  }

  console.log(`[${label}] Done. upserted=${upserted} skipped=${skipped} fetched=${raws.length}`);
  return { upserted, skipped, fetched: raws.length };
}

async function main() {
  if (!supabaseAdmin) {
    console.error('Supabase admin client missing — check SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const junkIds = [
    'reddit-1vikkox',
    'reddit-1v4ry1l',
    'reddit-1mc1zws',
    'reddit-1m5qfnh',
    'reddit-1iitx7t',
    'reddit-1fodfy5',
    'reddit-17kmjqq',
    'reddit-ik7d1g',
    'reddit-hh0emg',
  ];
  const { error: delErr } = await supabaseAdmin.from('mentions').delete().in('reddit_id', junkIds);
  if (delErr) console.warn('[UK/clients] junk delete:', delErr.message);
  else console.log(`[UK/clients] Removed ${junkIds.length} non-customer junk rows`);

  console.log('[UK/clients] Fetching Barclays + Likewize…');
  const barclays = await fetchBarclaysLikewizeMentions({ time: 'all' });
  await upsertBatch('Barclays', 'Barclays', barclays, (hay) => isLikewizeBrand(hay));

  console.log('[UK/clients] Fetching NatWest gadget/Likewize…');
  const natwest = await fetchNatwestLikewizeMentions({ time: 'all' });
  await upsertBatch(
    'NatWest',
    'NatWest',
    natwest,
    (hay, m) => isNatwestContext(hay, m.subreddit) && isLikewizeBrand(hay),
  );

  console.log('[UK/clients] Fetching VMO2 / O2 Recycle device trade-in…');
  const vmo2 = await fetchVmo2TradeInMentions({ time: 'all' });
  await upsertBatch(
    'VMO2',
    'VMO2',
    vmo2,
    (hay, m) => isO2RecycleDeviceContext(hay, m.subreddit) && isLikewizeBrand(hay),
  );

  console.log('[UK/clients] Fetching Samsung device trade-in + Likewize…');
  const samsung = await fetchSamsungTradeInMentions({ time: 'all' });
  await upsertBatch('Samsung-TradeIn', 'Samsung', samsung, (hay, m) =>
    isSamsungTradeInDeviceContext(hay, m.subreddit) && isLikewizeBrand(hay),
  );

  console.log('[UK/clients] All batches complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
