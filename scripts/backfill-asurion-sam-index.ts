/**
 * Fast Asurion_Sam backfill:
 * 1) Pull u/Asurion_Sam's Reddit comment history
 * 2) Match parent posts to existing Asurion mentions in Supabase
 * 3) Set has_official_reply / official_replier / merge comments
 *
 * Run: npx tsx scripts/backfill-asurion-sam-index.ts
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnvLocal() {
  const content = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // strip trailing inline comments for simple KEY=value # comment
    if (!value.startsWith('"') && !value.startsWith("'")) {
      value = value.replace(/\s+#.*$/, '').trim();
    } else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();
  const { supabaseAdmin } = await import('../lib/supabase');
  const { fetchAsurionSamReplyIndex } = await import('../lib/reddit');
  const { detectOfficialSupportReply, toRedditMentionId } = await import('../lib/officialSupport');
  const { mentionsAsurion } = await import('../lib/utils');

  if (!supabaseAdmin) throw new Error('Supabase not configured');

  const { hydrateAsurionSamParentThreads } = await import('../lib/reddit');
  const { classifyWithGrok } = await import('../lib/classify');

  const samIndex = await fetchAsurionSamReplyIndex(1000);
  console.log(`[sam-index] Threads with Asurion_Sam comments: ${samIndex.size}`);

  let allRows: any[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('mentions')
      .select('reddit_id, created_at, raw_data, content, title, source')
      .like('reddit_id', 'reddit-%')
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    allRows = allRows.concat(data);
    if (data.length < 1000) break;
  }
  console.log(`[sam-index] Loaded ${allRows.length} reddit mention rows`);

  // Insert parent posts Sam replied to that we don't already have
  const existingIds = new Set(allRows.map((r) => r.reddit_id));
  const parents = await hydrateAsurionSamParentThreads(samIndex, existingIds, 120);
  let insertedParents = 0;
  for (const p of parents) {
    const support = detectOfficialSupportReply({
      company: 'Asurion',
      comments: p.comments || [],
      full_thread: p.full_thread,
      created_at: p.created_at,
      knownOfficialComments: samIndex.get(p.id) || [],
    });
    let classification: any;
    try {
      classification = await classifyWithGrok(p.text);
    } catch {
      classification = {
        sentiment: 'neutral',
        pillar: 'Other',
        confidence: 0.5,
        key_issue: null,
      };
    }
    const dbRow: any = {
      source: 'reddit',
      retailer: p.client || 'Unassigned',
      subreddit: p.subreddit,
      title: p.title,
      content: p.text,
      url: p.url,
      author: p.author,
      reddit_id: p.id,
      created_at: p.created_at,
      sentiment: classification.sentiment,
      pillar: classification.pillar,
      confidence: classification.confidence,
      raw_data: {
        reddit_id: p.id,
        source: 'Reddit',
        company: 'Asurion',
        competitor: 'Asurion',
        client: p.client,
        comments: p.comments || [],
        full_thread: p.full_thread,
        has_official_reply: support.has_official_reply,
        first_official_reply_hours: support.first_official_reply_hours,
        official_replier: support.official_replier || 'Asurion_Sam',
        asurion_sam_indexed: true,
        product_type: 'other',
        original: p,
      },
    };
    const { error } = await supabaseAdmin.from('mentions').upsert(dbRow, { onConflict: 'reddit_id' });
    if (!error) {
      insertedParents++;
      console.log(`  + inserted parent ${p.id} (Asurion_Sam replied)`);
    }
  }

  // Re-load after inserts
  allRows = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('mentions')
      .select('reddit_id, created_at, raw_data, content, title, source')
      .like('reddit_id', 'reddit-%')
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    allRows = allRows.concat(data);
    if (data.length < 1000) break;
  }

  let matched = 0;
  let updated = 0;
  let withSam = 0;

  for (const row of allRows) {
    const raw = row.raw_data || {};
    const hay = `${row.content || ''} ${row.title || ''} ${raw.full_thread || ''}`;
    const company = raw.company || raw.competitor;
    const key = toRedditMentionId(row.reddit_id) || row.reddit_id;
    const samComments = samIndex.get(key) || [];
    const isAsurion =
      company === 'Asurion' ||
      mentionsAsurion(hay) ||
      mentionsAsurion(JSON.stringify(raw)) ||
      samComments.length > 0;
    if (!isAsurion) continue;

    if (samComments.length) matched++;

    const existingComments = Array.isArray(raw.comments) ? raw.comments : [];
    const originalComments = Array.isArray(raw.original?.comments) ? raw.original.comments : [];
    const seen = new Set<string>();
    const comments = [...existingComments, ...originalComments, ...samComments].filter((c: any) => {
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

    if (support.has_official_reply) withSam++;

    if (
      support.has_official_reply === !!raw.has_official_reply &&
      support.official_replier === (raw.official_replier ?? null) &&
      comments.length === existingComments.length &&
      company === 'Asurion' &&
      !samComments.length
    ) {
      continue;
    }

    if (!support.has_official_reply && !samComments.length && company === 'Asurion') {
      continue;
    }

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
        console.log(
          `  ✓ ${row.reddit_id} — Asurion_Sam (${support.first_official_reply_hours ?? '?'}h)`,
        );
      }
    }
  }

  console.log(`[sam-index] Done.`);
  console.log(`  Parent threads inserted: ${insertedParents}`);
  console.log(`  Sam history matched to DB threads: ${matched}`);
  console.log(`  Threads with Asurion_Sam reply flag: ${withSam}`);
  console.log(`  DB rows updated: ${updated}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
