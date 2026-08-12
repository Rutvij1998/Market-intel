import {
  fetchDeviceProtectionMentions,
  refreshRedditThreadComments,
  fetchAsurionSamReplyIndex,
  hydrateAsurionSamParentThreads,
} from '@/lib/reddit';
import { scrapePissedConsumer, scrapeLikewizeBBB, scrapeAsurionBBB } from '@/lib/scrapers';
import { classifyWithGrok, ClassifiedMention } from '@/lib/classify';
import { supabaseAdmin } from '@/lib/supabase';
import { isElectronicDeviceProtection, detectCompany, normalizeMentionSource, dedupeMentions, mentionDedupKey, mentionsAsurion } from '@/lib/utils';
import { detectOfficialSupportReply, toRedditMentionId, ASURION_OFFICIAL_ACCOUNT } from '@/lib/officialSupport';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SamIndex = Map<string, Array<{ author: string; body: string; created_utc?: number }>>;

/**
 * Fast path: apply u/Asurion_Sam's comment history onto existing Asurion rows in Supabase.
 * Covers threads even when we never expanded their full comment trees during scrape.
 */
async function applyAsurionSamIndexToDatabase(samIndex: SamIndex): Promise<number> {
  if (!supabaseAdmin || !samIndex.size) return 0;

  let allRows: any[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('mentions')
      .select('reddit_id, source, created_at, raw_data, content, title')
      .like('reddit_id', 'reddit-%')
      .order('created_at', { ascending: false })
      .range(from, from + 999);
    if (error || !data?.length) break;
    allRows = allRows.concat(data);
    if (data.length < 1000) break;
  }

  let updated = 0;
  let matched = 0;

  for (const row of allRows) {
    const raw = row.raw_data || {};
    const hay = `${row.content || ''} ${row.title || ''} ${raw.full_thread || ''}`;
    const company = raw.company || raw.competitor;
    const isAsurion =
      company === 'Asurion' || mentionsAsurion(hay) || mentionsAsurion(JSON.stringify(raw));
    if (!isAsurion) continue;

    const key = toRedditMentionId(row.reddit_id) || row.reddit_id;
    const samComments = samIndex.get(key) || [];
    const existingComments = Array.isArray(raw.comments) ? raw.comments : [];
    const originalComments = Array.isArray(raw.original?.comments) ? raw.original.comments : [];
    const mergedComments = [...existingComments, ...originalComments, ...samComments];

    // Dedupe comments by author+body+created_utc
    const seen = new Set<string>();
    const comments = mergedComments.filter((c: any) => {
      const k = `${c?.author || ''}|${(c?.body || '').slice(0, 80)}|${c?.created_utc || ''}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const support = detectOfficialSupportReply({
      company: 'Asurion',
      comments,
      full_thread: raw.full_thread,
      created_at: row.created_at,
      knownOfficialComments: samComments,
    });

    if (samComments.length) matched++;

    const alreadyCorrect =
      support.has_official_reply === !!raw.has_official_reply &&
      support.official_replier === (raw.official_replier ?? null) &&
      comments.length === existingComments.length &&
      company === 'Asurion';

    if (alreadyCorrect && !samComments.length) continue;

    // Always persist Sam hits; also re-tag company for Asurion rows
    if (!support.has_official_reply && !samComments.length && company === 'Asurion') continue;

    const { error: updateErr } = await supabaseAdmin
      .from('mentions')
      .update({
        raw_data: {
          ...raw,
          company: 'Asurion',
          competitor: 'Asurion',
          comments,
          has_official_reply: support.has_official_reply,
          first_official_reply_hours: support.first_official_reply_hours,
          official_replier: support.official_replier,
          asurion_sam_indexed: samComments.length > 0,
        },
      })
      .eq('reddit_id', row.reddit_id);

    if (!updateErr) {
      updated++;
      if (support.has_official_reply) {
        console.log(`[Ingest] Asurion_Sam reply on ${row.reddit_id} (${support.first_official_reply_hours ?? '?'}h)`);
      }
    }
  }

  console.log(
    `[Ingest] Asurion_Sam index applied: ${matched} threads matched Sam history, ${updated} DB rows updated (index size ${samIndex.size}).`,
  );
  return updated;
}

async function backfillRedditOfficialSupport() {
  if (!supabaseAdmin) return 0;

  // 1) Primary: Asurion_Sam user comment history (fast, comprehensive)
  let samUpdated = 0;
  try {
    const samIndex = await fetchAsurionSamReplyIndex(1000);
    samUpdated = await applyAsurionSamIndexToDatabase(samIndex);
  } catch (e: any) {
    console.error('[Ingest] Asurion_Sam index apply failed:', e?.message || e);
  }

  // 2) Secondary: expand a batch of Asurion threads still missing comments (rate-limited)
  let allRows: any[] = [];
  for (let from = 0; from < 3000; from += 1000) {
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

  if (!allRows.length) return samUpdated;

  const candidates = allRows
    .map((row) => {
      const raw = row.raw_data || {};
      const company = raw.company || raw.competitor;
      if (company !== 'Asurion') return null;
      if (raw.has_official_reply) return null; // already known
      const existingComments = raw.comments || raw.original?.comments || [];
      if (existingComments.length) return null;
      return { row, raw, company, priority: 0 };
    })
    .filter(Boolean) as Array<{ row: any; raw: any; company: string; priority: number }>;

  let refreshed = 0;
  const maxRefresh = 40; // Sam index covers most; only sample remaining
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

    await delay(1100);
  }

  if (refreshed > 0 || samUpdated > 0) {
    console.log(
      `[Ingest] Official support backfill: Sam-index updates=${samUpdated}, thread refreshes=${refreshed}.`,
    );
  }
  return samUpdated + refreshed;
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

export async function runIngestion({
  mode = 'update',
  /**
   * When set (daily cron), only classify + upsert mentions whose created_at
   * falls within this lookback (e.g. 24). Full/manual sync omit this.
   */
  sinceHours,
  /**
   * Soft deadline for serverless (Vercel maxDuration is 300s). Leave headroom
   * to finish DB writes + job_runs logging. When hit, return partial success.
   */
  maxRuntimeMs,
}: {
  mode?: 'full' | 'update';
  sinceHours?: number;
  maxRuntimeMs?: number;
} = {}) {
  const startedAtMs = Date.now();
  const deadlineAt =
    typeof maxRuntimeMs === 'number' && maxRuntimeMs > 0
      ? startedAtMs + maxRuntimeMs
      : null;
  const timeLeft = () => (deadlineAt == null ? Infinity : deadlineAt - Date.now());
  const pastDeadline = (reserveMs = 12_000) =>
    deadlineAt != null && Date.now() >= deadlineAt - reserveMs;

  const isFull = mode === 'full';
  const recentWindow =
    typeof sinceHours === 'number' && sinceHours > 0 ? sinceHours : null;
  const redditTime =
    recentWindow != null && recentWindow <= 24
      ? 'day'
      : recentWindow != null && recentWindow <= 168
        ? 'week'
        : 'all';

  // Daily cron: skip full-table repair (too slow for 300s budget). Manual/full still repair.
  if (!recentWindow) {
    await repairMislabeledSources({ skipBackfill: false });
  } else {
    console.log('[Ingest] Cron/window mode: skipping repairMislabeledSources for speed');
  }

  // Sources: Reddit + PissedConsumer + Likewize BBB + Asurion BBB.
  // Cron (sinceHours) uses aggressive caps so we finish under Vercel maxDuration.
  const fetchLimit = isFull ? 700 : recentWindow ? 80 : 450;
  const bbbLikewizePages = isFull ? 80 : recentWindow ? 2 : 80;
  const bbbAsurionPages = isFull ? 1000 : recentWindow ? 3 : 1000;
  const bbbTimeoutMs = recentWindow ? 35_000 : process.env.VERCEL ? 45_000 : undefined;

  console.log(
    `[Ingest] Starting ingestion (${isFull ? 'full' : 'update'}` +
      `${recentWindow ? `, last ${recentWindow}h only` : ''}` +
      `${deadlineAt ? `, budget ${Math.round(maxRuntimeMs! / 1000)}s` : ''}). ` +
      `Sources: Reddit (time=${redditTime}, limit=${fetchLimit}) + PissedConsumer + BBB ` +
      `(lw≤${bbbLikewizePages}p, as≤${bbbAsurionPages}p).`,
  );

  // Parallel scrapes with individual failure isolation (don't fail whole run)
  const withFallback = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (e: any) {
      console.warn(`[Ingest] ${label} failed:`, e?.message || e);
      return fallback;
    }
  };

  const [redditRaw, pcRaw, bbbLikewizeRaw, bbbAsurionRaw] = await Promise.all([
    withFallback('Reddit', () => fetchDeviceProtectionMentions(fetchLimit, { time: redditTime }), [] as any[]),
    withFallback('PissedConsumer', () => scrapePissedConsumer(), [] as any[]),
    withFallback(
      'BBB Likewize',
      () => scrapeLikewizeBBB(bbbLikewizePages, { timeoutMs: bbbTimeoutMs }),
      [] as any[],
    ),
    withFallback(
      'BBB Asurion',
      () => scrapeAsurionBBB(bbbAsurionPages, { timeoutMs: bbbTimeoutMs }),
      [] as any[],
    ),
  ]);
  const bbbRaw = [...bbbLikewizeRaw, ...bbbAsurionRaw];
  console.log(
    `[Ingest] Scrape done in ${Math.round((Date.now() - startedAtMs) / 1000)}s · ` +
      `reddit=${redditRaw.length} pc=${pcRaw.length} bbb=${bbbRaw.length} · ` +
      `${Math.round(timeLeft() / 1000)}s budget left`,
  );

  // Index u/Asurion_Sam comments → merge into Asurion mentions for official-reply metrics
  let samIndex: SamIndex = new Map();
  if (!pastDeadline(20_000)) {
    try {
      samIndex = await fetchAsurionSamReplyIndex(recentWindow ? 80 : 1000);
    } catch (e: any) {
      console.warn('[Ingest] Could not load Asurion_Sam history:', e?.message || e);
    }
  } else {
    console.warn('[Ingest] Skipping Asurion_Sam index (time budget)');
  }

  // Pull parent posts of Sam replies that our scrape may have missed
  let samParents: any[] = [];
  if (samIndex.size && !pastDeadline(15_000)) {
    const existingIds = new Set(redditRaw.map((r) => r.id));
    try {
      samParents = await hydrateAsurionSamParentThreads(
        samIndex,
        existingIds,
        recentWindow ? 10 : 100,
      );
    } catch (e: any) {
      console.warn('[Ingest] Sam parent hydrate failed:', e?.message || e);
    }
  }

  let allRaw = dedupeMentions([...redditRaw, ...samParents, ...pcRaw, ...bbbRaw]);

  // Attach known Asurion_Sam comments onto matching raw mentions
  if (samIndex.size) {
    let attached = 0;
    for (const raw of allRaw as any[]) {
      const key = toRedditMentionId(raw.id);
      if (!key) continue;
      const samComments = samIndex.get(key);
      if (!samComments?.length) continue;
      const existing = Array.isArray(raw.comments) ? raw.comments : [];
      raw.comments = [...existing, ...samComments];
      raw.company = 'Asurion';
      attached++;
    }
    console.log(`[Ingest] Attached Asurion_Sam comments to ${attached} threads (index ${samIndex.size}, parents +${samParents.length}).`);
  }

  // Filter: PissedConsumer + BBB always kept; Asurion always kept; others need device protection.
  let filteredRaw = allRaw.filter((raw: any) => {
    const source = (raw.source || '').toLowerCase();
    if (source.includes('pissedconsumer') || source.includes('pissed')) return true;
    if (source.includes('bbb') || String(raw.id || '').startsWith('bbb-')) return true;
    const hay = `${raw.text || ''} ${raw.title || ''} ${(raw as any).full_thread || ''}`;
    if (mentionsAsurion(hay) || raw.company === 'Asurion') return true;
    const ok = isElectronicDeviceProtection(hay);
    if (!ok) {
      console.log(`[Ingest] EXCLUDED non-device-protection: ${raw.source || 'unknown'} ${raw.id} (company hint: ${detectCompany(hay)})`);
    }
    return ok;
  });

  // Daily cron: only last N hours (by source post date)
  if (recentWindow != null) {
    const cutoffMs = Date.now() - recentWindow * 60 * 60 * 1000;
    const beforeAge = filteredRaw.length;
    filteredRaw = filteredRaw.filter((raw: any) => {
      const ts = new Date(raw.created_at || 0).getTime();
      if (!ts || Number.isNaN(ts)) {
        console.log(`[Ingest] EXCLUDED undated item in ${recentWindow}h window: ${raw.id}`);
        return false;
      }
      return ts >= cutoffMs;
    });
    console.log(
      `[Ingest] Last ${recentWindow}h date filter: ${filteredRaw.length} / ${beforeAge} kept ` +
        `(cutoff ${new Date(cutoffMs).toISOString()}).`,
    );
  }

  console.log(
    `[Ingest] ${filteredRaw.length} / ${allRaw.length} items kept ` +
      `(PC + BBB + Asurion unrestricted + device protection` +
      `${recentWindow ? ` + last ${recentWindow}h` : ''}). Classifying...`,
  );

  const classified: ClassifiedMention[] = [];
  let companyCounts = { Likewize: 0, Asurion: 0, Allstate: 0, SquareTrade: 0, Other: 0 };
  let stoppedEarly = false;
  let classifiedAttempted = 0;

  for (const raw of filteredRaw) {
    if (pastDeadline(10_000)) {
      stoppedEarly = true;
      console.warn(
        `[Ingest] Time budget nearly exhausted after ${classifiedAttempted}/${filteredRaw.length} items — finishing early`,
      );
      break;
    }
    classifiedAttempted++;
    const haystack = `${raw.text || ''} ${(raw as any).full_thread || ''} ${(raw as any).title || ''}`;
    const preCompany =
      raw.company === 'Asurion' || mentionsAsurion(haystack)
        ? 'Asurion'
        : detectCompany(haystack);
    const isPissedConsumer = (raw.source || '').toLowerCase().includes('pissed');
    const isBBB =
      (raw.source || '').toLowerCase().includes('bbb') || String(raw.id || '').startsWith('bbb-');
    // Asurion BBB ids look like bbb-0573_2131781_* ; Likewize bbb-0825_1000202069_*
    const isAsurionBBB =
      isBBB &&
      (raw.company === 'Asurion' ||
        String(raw.id || '').includes('2131781') ||
        String(raw.id || '').includes('0573_2131781'));
    const isLikewizeBBB = isBBB && !isAsurionBBB;
    const isAsurionAll =
      preCompany === 'Asurion' ||
      mentionsAsurion(haystack) ||
      isAsurionBBB ||
      raw.company === 'Asurion';
    const isDevice = isElectronicDeviceProtection(haystack);

    let classification;
    try {
      classification = await classifyWithGrok(raw.text, (raw as any).client);
    } catch (classErr: any) {
      console.error(`[Ingest] Classification failed for ${raw.id}, rule fallback:`, classErr?.message || classErr);
      classification = { 
        sentiment: 'neutral', pillar: 'Other', confidence: 0.4, key_issue: 'Classification error',
        company: preCompany, product_type: isDevice ? 'electronic_device_protection' : 'other', is_relevant: true 
      };
    }

    if (isPissedConsumer || isLikewizeBBB) {
      classification = {
        ...classification,
        company: 'Likewize',
        is_relevant: true,
        product_type: 'electronic_device_protection',
      };
    }

    // Asurion Reddit + Asurion BBB — competitor analysis only (never Overview)
    if (isAsurionAll) {
      classification = {
        ...classification,
        company: 'Asurion',
        is_relevant: true,
        product_type: isDevice || isAsurionBBB ? 'electronic_device_protection' : (classification.product_type || 'other'),
      };
    }

    // Final relevance gate (PissedConsumer + BBB + Asurion always kept)
    if (
      !isPissedConsumer &&
      !isBBB &&
      !isAsurionAll &&
      (classification.is_relevant === false || classification.product_type === 'other')
    ) {
      console.log(`[Ingest] Skipping after classify (non-device): ${raw.id}`);
      continue;
    }

    const finalCompany = isPissedConsumer || isLikewizeBBB
      ? 'Likewize'
      : isAsurionAll
        ? 'Asurion'
        : ((classification.company as any) || preCompany || 'Other');
    if (finalCompany in companyCounts) {
      (companyCounts as any)[finalCompany]++;
    } else {
      companyCounts.Other++;
    }

    const productType =
      finalCompany === 'Asurion'
        ? (isDevice ? 'electronic_device_protection' : 'other')
        : 'electronic_device_protection';

    const samCommentsForPost =
      finalCompany === 'Asurion'
        ? samIndex.get(toRedditMentionId(raw.id) || raw.id) || []
        : [];
    const support =
      finalCompany === 'Asurion' || finalCompany === 'Likewize'
        ? detectOfficialSupportReply({
            company: finalCompany,
            comments: (raw as any).comments || [],
            full_thread: (raw as any).full_thread,
            created_at: raw.created_at,
            knownOfficialComments: samCommentsForPost,
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
      product_type: productType as any,
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
        product_type: productType,
        asurion_unrestricted: finalCompany === 'Asurion',
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
    bbb: bbbRaw.length,
    bbb_likewize: bbbLikewizeRaw.length,
    bbb_asurion: bbbAsurionRaw.length,
  };

  const elapsedSec = Math.round((Date.now() - startedAtMs) / 1000);
  console.log(
    `[Ingest] Company breakdown: Likewize=${companyCounts.Likewize}, Asurion=${companyCounts.Asurion}, ` +
      `Allstate=${companyCounts.Allstate}, SquareTrade=${companyCounts.SquareTrade}, Other=${companyCounts.Other}. ` +
      `Total kept: ${classified.length} (Reddit + PC + BBB=${bbbRaw.length}). ` +
      `Elapsed ${elapsedSec}s` +
      (stoppedEarly ? ` · stopped early (${classifiedAttempted}/${filteredRaw.length} processed)` : '') +
      '.',
  );

  const baseMsg = supabaseAdmin
    ? `Ingested and saved ${classified.length} mentions from Reddit + PissedConsumer + BBB`
    : `Ingested ${classified.length} mentions (no Supabase)`;
  const message = stoppedEarly
    ? `${baseMsg} (partial — hit ${Math.round((maxRuntimeMs || 0) / 1000)}s time budget after ${classifiedAttempted}/${filteredRaw.length}).`
    : `${baseMsg}.`;

  return {
    success: true,
    count: classified.length,
    mentions: classified,
    sources,
    message,
    partial: stoppedEarly,
    elapsedMs: Date.now() - startedAtMs,
    processed: classifiedAttempted,
    candidates: filteredRaw.length,
  };
}
