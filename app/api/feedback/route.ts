import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export interface ThreadFeedbackPayload {
  mention_id?: string | null;
  reddit_id?: string | null;
  thread_url: string;
  source?: string | null;
  title?: string | null;
  company?: string | null;
  client?: string | null;
  pillar?: string | null;
  business_line?: string | null;
  sentiment?: string | null;
  useful?: boolean;
  rating?: number | null;
  comment?: string | null;
  viewer_key: string;
  active_filters?: Record<string, unknown> | null;
  why_reasons?: unknown[] | null;
}

function badRequest(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function isMissingTableError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = err.message || '';
  return (
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    /does not exist/i.test(msg) ||
    /schema cache/i.test(msg) ||
    /could not find the table/i.test(msg)
  );
}

const SETUP_HINT =
  'Create the table: Supabase → SQL Editor → paste supabase/migrations/002_thread_feedback.sql → Run. Then retry.';

/** POST — submit star rating + comment for a thread (once per viewer_key + url). */
export async function POST(request: Request) {
  if (!supabaseAdmin) {
    return badRequest('Supabase is not configured on the server.', 503);
  }

  let body: ThreadFeedbackPayload;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body.');
  }

  const threadUrl = (body.thread_url || '').trim();
  const viewerKey = (body.viewer_key || '').trim();
  if (!threadUrl) return badRequest('thread_url is required.');
  if (!viewerKey || viewerKey.length < 8) return badRequest('viewer_key is required.');

  const ratingRaw = body.rating;
  const rating =
    typeof ratingRaw === 'number' && Number.isFinite(ratingRaw)
      ? Math.round(ratingRaw)
      : null;
  if (rating == null || rating < 1 || rating > 5) {
    return badRequest('rating must be an integer from 1 to 5.');
  }

  // Useful = 4–5 stars (or explicit useful flag if provided)
  const useful =
    typeof body.useful === 'boolean' ? body.useful : rating >= 4;

  const comment = (body.comment || '').trim() || null;
  if (!comment || comment.length < 2) {
    return badRequest(
      useful
        ? 'Please add a short comment with your rating.'
        : 'Please share brief feedback with your rating.',
    );
  }
  if (comment.length > 4000) return badRequest('Comment is too long (max 4000 chars).');

  const row = {
    mention_id: body.mention_id || null,
    reddit_id: body.reddit_id || null,
    thread_url: threadUrl,
    source: body.source || null,
    title: (body.title || '').slice(0, 500) || null,
    company: body.company || null,
    client: body.client || null,
    pillar: body.pillar || null,
    business_line: body.business_line || null,
    sentiment: body.sentiment || null,
    useful,
    rating,
    comment,
    viewer_key: viewerKey.slice(0, 128),
    active_filters: body.active_filters || null,
    why_reasons: body.why_reasons || null,
  };

  // If already submitted, return existing (once per viewer + thread)
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('thread_feedback')
    .select('id, useful, rating, comment, created_at')
    .eq('viewer_key', row.viewer_key)
    .eq('thread_url', row.thread_url)
    .maybeSingle();

  if (existingErr) {
    if (isMissingTableError(existingErr)) {
      return badRequest(SETUP_HINT, 503);
    }
    console.error('[feedback] lookup error:', existingErr);
    return badRequest(existingErr.message || 'Failed to check existing feedback.', 500);
  }

  if (existing) {
    return NextResponse.json({
      ok: true,
      alreadySubmitted: true,
      feedback: existing,
    });
  }

  const { data, error } = await supabaseAdmin
    .from('thread_feedback')
    .insert(row)
    .select('id, useful, rating, created_at')
    .maybeSingle();

  if (error) {
    if (error.code === '23505' || /duplicate|unique/i.test(error.message || '')) {
      const { data: raced } = await supabaseAdmin
        .from('thread_feedback')
        .select('id, useful, rating, comment, created_at')
        .eq('viewer_key', row.viewer_key)
        .eq('thread_url', row.thread_url)
        .maybeSingle();
      return NextResponse.json({
        ok: true,
        alreadySubmitted: true,
        feedback: raced,
      });
    }

    if (isMissingTableError(error)) {
      return badRequest(SETUP_HINT, 503);
    }

    // Column missing (old table without rating)
    if (error.code === 'PGRST204' || /rating/i.test(error.message || '')) {
      const { rating: _drop, ...rowWithoutRating } = row;
      const { data: fallback, error: fallbackErr } = await supabaseAdmin
        .from('thread_feedback')
        .insert(rowWithoutRating)
        .select('id, useful, created_at')
        .maybeSingle();
      if (!fallbackErr) {
        return NextResponse.json({ ok: true, feedback: { ...fallback, rating } });
      }
    }

    console.error('[feedback] insert error:', error);
    return badRequest(error.message || 'Failed to save feedback.', 500);
  }

  return NextResponse.json({ ok: true, feedback: data });
}

/** GET — check if this viewer already submitted feedback for a thread. */
export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return badRequest('Supabase is not configured on the server.', 503);
  }

  const { searchParams } = new URL(request.url);
  const viewerKey = (searchParams.get('viewer_key') || '').trim();
  const threadUrl = (searchParams.get('thread_url') || '').trim();
  if (!viewerKey || !threadUrl) {
    return badRequest('viewer_key and thread_url are required.');
  }

  const { data, error } = await supabaseAdmin
    .from('thread_feedback')
    .select('id, useful, rating, comment, created_at')
    .eq('viewer_key', viewerKey)
    .eq('thread_url', threadUrl)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ ok: true, submitted: false, tableMissing: true });
    }
    console.error('[feedback] get error:', error);
    return badRequest(error.message || 'Failed to load feedback.', 500);
  }

  return NextResponse.json({
    ok: true,
    submitted: !!data,
    feedback: data || null,
  });
}
