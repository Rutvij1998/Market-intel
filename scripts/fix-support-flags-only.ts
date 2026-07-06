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

/** Fast DB-only repair — no Reddit API calls. Fixes stale Likewize flags + recomputes Asurion_Sam from stored comments. */
async function main() {
  loadEnvLocal();
  const { supabaseAdmin } = await import('../lib/supabase');
  const { detectOfficialSupportReply } = await import('../lib/officialSupport');
  if (!supabaseAdmin) throw new Error('Supabase not configured');

  const { data, error } = await supabaseAdmin.from('mentions').select('reddit_id, created_at, raw_data');
  if (error) throw error;

  let fixed = 0;
  for (const row of data || []) {
    const raw = row.raw_data || {};
    const company = raw.company || raw.competitor;
    if (company !== 'Asurion' && company !== 'Likewize') continue;

    const support = detectOfficialSupportReply({
      company,
      comments: raw.comments || [],
      full_thread: raw.full_thread,
      created_at: row.created_at,
    });

    const needsFix =
      support.has_official_reply !== (raw.has_official_reply ?? false) ||
      support.official_replier !== (raw.official_replier ?? null) ||
      ['likewize', 'asurion'].includes(String(raw.official_replier || '').toLowerCase());

    if (!needsFix) continue;

    await supabaseAdmin
      .from('mentions')
      .update({
        raw_data: {
          ...raw,
          has_official_reply: support.has_official_reply,
          first_official_reply_hours: support.first_official_reply_hours,
          official_replier: support.official_replier,
        },
      })
      .eq('reddit_id', row.reddit_id);
    fixed++;
  }

  console.log(`[fix-support-flags] Repaired ${fixed} rows (no Reddit API used).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});