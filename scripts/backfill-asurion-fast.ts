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
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();
  const { supabaseAdmin } = await import('../lib/supabase');
  const { refreshRedditThreadComments } = await import('../lib/reddit');
  const { detectOfficialSupportReply } = await import('../lib/officialSupport');

  if (!supabaseAdmin) throw new Error('Supabase not configured');

  const { data, error } = await supabaseAdmin
    .from('mentions')
    .select('reddit_id, created_at, raw_data')
    .like('reddit_id', 'reddit-%');

  if (error) throw error;

  const asurionMissing = (data || []).filter((row: any) => {
    const raw = row.raw_data || {};
    const company = raw.company || raw.competitor;
    if (company !== 'Asurion') return false;
    return !(raw.comments || []).length;
  });

  console.log(`[backfill-asurion-fast] ${asurionMissing.length} Asurion threads need comments`);

  let refreshed = 0;
  let asurionSamFound = 0;

  for (const row of asurionMissing) {
    const raw = row.raw_data || {};
    const refreshedThread = await refreshRedditThreadComments(row.reddit_id);
    if (!refreshedThread) continue;

    const support = detectOfficialSupportReply({
      company: 'Asurion',
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
          company: 'Asurion',
        },
      })
      .eq('reddit_id', row.reddit_id);

    if (!updateErr) {
      refreshed++;
      if (support.has_official_reply) {
        asurionSamFound++;
        console.log(`  ✓ ${row.reddit_id} — Asurion_Sam replied`);
      }
    }

    await new Promise((r) => setTimeout(r, 900));
  }

  const total = (data || []).filter((r: any) => (r.raw_data?.company || r.raw_data?.competitor) === 'Asurion').length;
  const withSam = (data || []).filter((r: any) => {
    const raw = r.raw_data || {};
    return (raw.company || raw.competitor) === 'Asurion' && raw.has_official_reply;
  }).length;

  console.log(`[backfill-asurion-fast] Done. Backfilled ${refreshed} threads. New Asurion_Sam this run: ${asurionSamFound}`);
  console.log(`[backfill-asurion-fast] Totals will update after recount — run verify next.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});