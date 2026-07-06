import { fetchDeviceProtectionMentions, refreshRedditThreadComments } from '@/lib/reddit';
import { scrapePissedConsumer } from '@/lib/scrapers';
import { classifyWithGrok, ClassifiedMention } from '@/lib/classify';
import { supabaseAdmin } from '@/lib/supabase';
import { isElectronicDeviceProtection, detectCompany, normalizeMentionSource, dedupeMentions, mentionDedupKey } from '@/lib/utils';
import { detectOfficialSupportReply } from '@/lib/officialSupport';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function backfillRedditOfficialSupport() {
  if (!supabaseAdmin) return 0;

  let allRows: any[] = [];
  for (let from = 0; from < 2000; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('mentions')
      .select('reddit_id, source, created_at, raw_data')
      .like('reddit_id', 'reddit-%')
      .order('created_at', { ascending: false })
      .range(from, from + 999);
    if (error || !data?.length) break;
    allRows = allRows.concat(data);
    if (data.length < 1000) break;
  }

  if (!allRows.length) return 0;

  const candidates = allRows
    .map((row) => {
      const raw = row.raw_data || {};
      const company = raw.company || raw.competitor;
      // Only Asurion has a known official account (Asurion_Sam). Skip Likewize backfill.
      if (company !== 'Asurion') return null;
      const existingComments = raw.comments || raw.original?.comments || [];
      if (existingComments.length) return null;
      return { row, raw, company, priority: 0 };
    })
    .filter(Boolean) as Array<{ row: any; raw: any; company: string; priority: number }>;

  candidates.sort((a, b) => a.priority - b.priority);

  let refreshed = 0;
  const maxRefresh = 90;
  for (const { row, raw, company } of candidates) {
    if (refreshed >= maxRefresh) break;

    const refreshedThread = await refreshRedditThreadComments(row.reddit_id);
    if (!refreshedThread) continue;

    const support = detectOfficialSupportReply({
      company,
      comments: refreshedThread.comments,
      full_thread: refreshedThread.full_thread,
      created_at: row.created_at,
    });

    const { error: updateErr } = await supabaseAdmin
      .from('mentions')
      .update({
        raw_data: {
          ...raw,
          comments: refreshedThread.comments,
          full_thread: refreshedThread.full_thread,
          has_official_reply: support.has_official_reply,
          first_official_reply_hours: support.first_official_reply_hours,
          official_replier: support.official_replier,
          company,
        },
      })
      .eq('reddit_id', row.reddit_id);

    if (!updateErr) {
      refreshed++;
      if (support.has_official_reply) {
        console.log(`[Ingest] Official support found on ${row.reddit_id}: ${support.official_replier}`);
      }
    }

    await delay(1200);
  }

  if (refreshed > 0) {
    console.log(`[Ingest] Backfilled Reddit comments for ${refreshed} thread(s) (official support scan).`);
  }
  return refreshed;
}

export async function repairMislabeledSources(opts: { skipBackfill?: boolean } = {}) {
  if (!supabaseAdmin) return;

  if (!opts.skipBackfill) {
    await backfillRedditOfficialSupport();
  }

  const { data, error } = await supabaseAdmin
    .from('mentions')
    .select('reddit_id, source, url, content, created_at, raw_data')
    .order('created_at', { ascending: false })
    .limit(2000);

  if (error || !data?.length) return;

  let repairedSources = 0;
  let repairedDates = 0;
  let removedDuplicates = 0;

  const grouped = new Map<string, any[]>();
  for (const row of data as any[]) {
    const raw = row.raw_data || {};
    const key = mentionDedupKey({
      id: row.reddit_id,
      text: row.content || raw.full_thread || '',
      url: row.url,
    });
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  for (const rows of grouped.values()) {
    if (rows.length > 1) {
      const sorted = [...rows].sort((a, b) => {
        const score = (r: any) => {
          let s = 0;
          if (/^pc-\d{6,}$/.test(r.reddit_id || '')) s += 10;
          if (/^pc-likewize-/.test(r.reddit_id || '')) s -= 5;
          const ts = new Date(r.created_at || 0).getTime();
          if (ts > 0 && ts < Date.now() - 48 * 60 * 60 * 1000) s += 5;
          return s;
        };
        return score(b) - score(a);
      });
      const keeper = sorted[0];
      for (const dup of sorted.slice(1)) {
        const { error: delErr } = await supabaseAdmin.from('mentions').delete().eq('reddit_id', dup.reddit_id);
        if (!delErr) removedDuplicates++;
      }
      rows.splice(0, rows.length, keeper);
    }

    const row = rows[0];
    const raw = row.raw_data || {};
    const correctedSource = normalizeMentionSource(raw.source || row.source, {
      url: row.url,
      id: row.reddit_id,
    });

    const originalCreatedAt = raw.original?.created_at || raw.created_at;
    const createdTs = new Date(row.created_at || 0).getTime();
    const looksIngestedNow = createdTs > Date.now() - 6 * 60 * 60 * 1000;
    const correctedCreatedAt =
      looksIngestedNow && originalCreatedAt && !isNaN(new Date(originalCreatedAt).getTime())
        ? new Date(originalCreatedAt).toISOString()
        : null;

    const patch: Record<string, string> = {};
    if (correctedSource !== row.source) patch.source = correctedSource;
    if (correctedCreatedAt && correctedCreatedAt !== row.created_at) patch.created_at = correctedCreatedAt;

    if (Object.keys(patch).length) {
      const { error: updateErr } = await supabaseAdmin.from('mentions').update(patch).eq('reddit_id', row.reddit_id);
      if (!updateErr) {
        if (patch.source) repairedSources++;
        if (patch.created_at) repairedDates++;
      }
    }
  }

  let repairedOfficialSupport = 0;
  for (const row of data as any[]) {
    const raw = row.raw_data || {};
    const company = raw.company || raw.competitor || detectCompany(row.content || '');
    if (company !== 'Asurion' && company !== 'Likewize') continue;

    const support = detectOfficialSupportReply({
      company,
      comments: raw.comments || raw.original?.comments || [],
      full_thread: raw.full_thread || raw.original?.full_thread,
      created_at: row.created_at,
    });

    const patch: Record<string, any> = {};
    const staleReplier = ['likewize', 'asurion'].includes(
      String(raw.official_replier || '').toLowerCase(),
    );
    if (support.has_official_reply !== (raw.has_official_reply ?? false) || staleReplier) {
      patch.has_official_reply = support.has_official_reply;
    }
    if (support.first_official_reply_hours !== (raw.first_official_reply_hours ?? null) || staleReplier) {
      patch.first_official_reply_hours = support.first_official_reply_hours;
    }
    if (support.official_replier !== (raw.official_replier ?? null) || staleReplier) {
      patch.official_replier = support.official_replier;
    }
    if (!Object.keys(patch).length) continue;

    const { error: updateErr } = await supabaseAdmin
      .from('mentions')
      .update({
        raw_data: {
          ...raw,
          ...patch,
          company,
        },
      })
      .eq('reddit_id', row.reddit_id);
    if (!updateErr) repairedOfficialSupport++;
  }

  if (repairedSources || repairedDates || removedDuplicates || repairedOfficialSupport) {
    console.log(`[Ingest] Repaired mentions: sources=${repairedSources}, dates=${repairedDates}, duplicates_removed=${removedDuplicates}, official_support=${repairedOfficialSupport}`);
  }
}

export async function runIngestion({ mode = 'update' }: { mode?: 'full' | 'update' } = {}) {
  const isFull = mode === 'full';

  await repairMislabeledSources();

  // Sources: Reddit + PissedConsumer only.
  const fetchLimit = isFull ? 400 : 220;
  console.log(`[Ingest] Starting ingestion (${isFull ? 'full' : 'update'}). Sources: Reddit + PissedConsumer (all pages).`);

  const redditRaw = await fetchDeviceProtectionMentions(fetchLimit);
  const pcRaw = await scrapePissedConsumer();

  let allRaw = dedupeMentions([...redditRaw, ...pcRaw]);

  // Final hard filter for electronic device protection only (belt + suspenders)
  const filteredRaw = allRaw.filter((raw: any) => {
    const source = (raw.source || '').toLowerCase();
    if (source.includes('pissedconsumer') || source.includes('pissed')) return true;
    const hay = `${raw.text || ''} ${raw.title || ''} ${(raw as any).full_thread || ''}`;
    const ok = isElectronicDeviceProtection(hay);
    if (!ok) {
      console.log(`[Ingest] EXCLUDED non-device-protection: ${raw.source || 'unknown'} ${raw.id} (company hint: ${detectCompany(hay)})`);
    }
    return ok;
  });

  console.log(`[Ingest] ${filteredRaw.length} / ${allRaw.length} items passed electronic device protection filter. Classifying...`);

  const classified: ClassifiedMention[] = [];
  let companyCounts = { Likewize: 0, Asurion: 0, Allstate: 0, SquareTrade: 0, Other: 0 };

  for (const raw of filteredRaw) {
    const haystack = `${raw.text || ''} ${(raw as any).full_thread || ''} ${(raw as any).title || ''}`;
    const preCompany = detectCompany(haystack);
    const isPissedConsumer = (raw.source || '').toLowerCase().includes('pissed');

    let classification;
    try {
      classification = await classifyWithGrok(raw.text, (raw as any).client);
    } catch (classErr: any) {
      console.error(`[Ingest] Classification failed for ${raw.id}, rule fallback:`, classErr?.message || classErr);
      classification = { 
        sentiment: 'neutral', pillar: 'Other', confidence: 0.4, key_issue: 'Classification error',
        company: preCompany, product_type: 'electronic_device_protection', is_relevant: true 
      };
    }

    if (isPissedConsumer) {
      classification = {
        ...classification,
        company: 'Likewize',
        is_relevant: true,
        product_type: 'electronic_device_protection',
      };
    }

    // Final relevance gate from classification (PissedConsumer reviews are always kept)
    if (!isPissedConsumer && (classification.is_relevant === false || classification.product_type === 'other')) {
      console.log(`[Ingest] Skipping after classify (non-device): ${raw.id}`);
      continue;
    }

    const finalCompany = isPissedConsumer ? 'Likewize' : ((classification.company as any) || preCompany || 'Other');
    if (finalCompany in companyCounts) {
      (companyCounts as any)[finalCompany]++;
    } else {
      companyCounts.Other++;
    }

    const support =
      finalCompany === 'Asurion' || finalCompany === 'Likewize'
        ? detectOfficialSupportReply({
            company: finalCompany,
            comments: (raw as any).comments || [],
            full_thread: (raw as any).full_thread,
            created_at: raw.created_at,
          })
        : { has_official_reply: false, first_official_reply_hours: null, official_replier: null };
    const { has_official_reply, first_official_reply_hours, official_replier } = support;

    // Build ClassifiedMention (UI + competitor tab compatible)
    const item: ClassifiedMention = {
      id: raw.id,
      text: raw.text,
      source: normalizeMentionSource(raw.source, { url: raw.url, id: raw.id }),
      url: raw.url,
      created_at: raw.created_at,
      sentiment: classification.sentiment,
      pillar: classification.pillar,
      confidence: classification.confidence,
      key_issue: classification.key_issue,
      client: (raw as any).client,
      title: (raw as any).title,
      rating: (raw as any).rating ?? null,
      subreddit: (raw as any).subreddit,
      full_thread: (raw as any).full_thread,
      company: finalCompany,
      product_type: 'electronic_device_protection',
      is_relevant: true,
      has_official_reply,
      first_official_reply_hours,
      official_replier,
    } as ClassifiedMention;

    classified.push(item);

    // DB row — store company and product_type in raw_data for compatibility + top level when columns exist
    const dbRow: any = {
      source: normalizeMentionSource(raw.source, { url: raw.url, id: raw.id }),
      retailer: (raw as any).client || finalCompany, // retailer_context fallback
      subreddit: (raw as any).subreddit,
      title: (raw as any).title,
      content: raw.text,
      url: raw.url,
      author: (raw as any).author,
      reddit_id: raw.id, // works for non-reddit too as unique key
      created_at: raw.created_at,
      sentiment: classification.sentiment,
      pillar: classification.pillar,
      confidence: classification.confidence,
      // All competitor fields (company, has_official_reply etc) are stored inside raw_data (JSONB)
      // so they are always available even if top-level columns have not been added yet.
      // Run the ALTER statements at the bottom of the migration file to add top-level columns if desired.
      raw_data: {
        reddit_id: raw.id,
        source: raw.source,
        company: finalCompany,
        competitor: finalCompany,  // explicit for competitor tab
        client: (raw as any).client,
        retailer_context: (raw as any).client || (raw as any).subreddit || '',
        rating: (raw as any).rating,
        full_thread: (raw as any).full_thread,
        comments: (raw as any).comments || [],
        has_official_reply,
        first_official_reply_hours,
        official_replier,
        product_type: 'electronic_device_protection',
        original: raw,
      }
    };

    if (supabaseAdmin) {
      try {
        await supabaseAdmin.from('mentions').upsert(dbRow, { onConflict: 'reddit_id' });
      } catch (insertErr: any) {
        console.error('Supabase upsert error:', insertErr?.message || insertErr);
      }
    }
  }

  const sources = {
    reddit: redditRaw.length,
    pissedconsumer: pcRaw.length,
  };

  console.log(`[Ingest] Company breakdown (after classification + filters): Likewize=${companyCounts.Likewize}, Asurion=${companyCounts.Asurion}, Allstate=${companyCounts.Allstate}, SquareTrade=${companyCounts.SquareTrade}, Other=${companyCounts.Other}. Total kept: ${classified.length} (Reddit + PissedConsumer).`);

  return {
    success: true,
    count: classified.length,
    mentions: classified,
    sources,
    message: supabaseAdmin 
      ? `Ingested and saved ${classified.length} mentions from Reddit + PissedConsumer.`
      : 'Ingested (no Supabase).',
  };
}
