import { NextResponse } from 'next/server';
import { generateDraftReply, type DraftReplyInput, type DraftReplyMode } from '@/lib/draftReply';
import { getRequestPermissions, REPLY_FORBIDDEN_MESSAGE } from '@/lib/roles';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/reply/draft
 * mode: "generate" (default) | "rewrite"
 * - generate: draft from thread; pass previousReply + variation for regenerate
 * - rewrite: polish draftText the user wrote/edited
 * Requires session + responder/admin role.
 */
export async function POST(request: Request) {
  try {
    const perms = await getRequestPermissions(request);
    if (!perms) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!perms.canReply) {
      return NextResponse.json(
        { success: false, error: REPLY_FORBIDDEN_MESSAGE, code: 'REPLY_FORBIDDEN' },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => null)) as
      | (DraftReplyInput & { mode?: string })
      | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'JSON body required' }, { status: 400 });
    }

    const mode: DraftReplyMode = body.mode === 'rewrite' ? 'rewrite' : 'generate';

    if (mode === 'rewrite') {
      const draftText = String(body.draftText || '').trim();
      if (!draftText) {
        return NextResponse.json(
          { success: false, error: 'Write something in the box first, then use Edit with AI' },
          { status: 400 },
        );
      }
    } else {
      const text = String(body.text || body.title || '').trim();
      if (!text) {
        return NextResponse.json({ success: false, error: 'Thread text is required' }, { status: 400 });
      }
    }

    const result = await generateDraftReply({
      text: String(body.text || ''),
      title: body.title,
      source: body.source,
      client: body.client,
      subreddit: body.subreddit,
      author: body.author,
      sentiment: body.sentiment,
      pillar: body.pillar,
      key_issue: body.key_issue,
      company: body.company,
      business_line: body.business_line,
      url: body.url,
      mode,
      draftText: body.draftText,
      previousReply: body.previousReply,
      variation: typeof body.variation === 'number' ? body.variation : undefined,
      nonce:
        typeof body.nonce === 'string' && body.nonce.trim()
          ? body.nonce.trim()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });

    if (!result.reply) {
      return NextResponse.json({ success: false, error: 'Could not draft a reply' }, { status: 422 });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'failed';
    console.error('[reply/draft]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
