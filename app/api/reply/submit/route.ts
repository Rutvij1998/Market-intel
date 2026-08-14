import { NextResponse } from 'next/server';
import { extractRedditSubmissionId, postRedditReply } from '@/lib/reddit';
import { getRequestPermissions, REPLY_FORBIDDEN_MESSAGE } from '@/lib/roles';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/reply/submit
 * Submit a drafted reply to the original public thread.
 * Currently auto-posts only for Reddit (via configured script credentials).
 * Other sources: returns openUrl so the client can open the original page.
 *
 * Session + responder/admin role required.
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

    const body = (await request.json().catch(() => null)) as {
      text?: string;
      url?: string;
      id?: string;
      source?: string;
      confirm?: boolean;
    } | null;

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'JSON body required' }, { status: 400 });
    }

    const text = String(body.text || '').trim();
    if (!text) {
      return NextResponse.json({ success: false, error: 'Reply text is empty' }, { status: 400 });
    }

    // Require explicit confirm so a stray click doesn't post
    if (body.confirm !== true) {
      return NextResponse.json(
        { success: false, error: 'Confirmation required (confirm: true)' },
        { status: 400 },
      );
    }

    const source = String(body.source || '').toLowerCase();
    const url = String(body.url || '').trim();
    const isReddit =
      source.includes('reddit') ||
      /reddit\.com|redd\.it/i.test(url) ||
      !!extractRedditSubmissionId({ id: body.id, url });

    if (!isReddit) {
      if (!url) {
        return NextResponse.json(
          {
            success: false,
            error:
              'Auto-post is only available for Reddit. This source has no openable URL — copy the reply and post manually.',
          },
          { status: 422 },
        );
      }
      return NextResponse.json({
        success: true,
        method: 'open',
        message:
          'This source does not support auto-post from Market Vantage. Opening the original page — paste your reply there.',
        openUrl: url,
        text,
      });
    }

    const submissionId = extractRedditSubmissionId({ id: body.id, url });
    if (!submissionId) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Could not find a Reddit post id from this mention. Open the original thread and post manually.',
          openUrl: url || null,
        },
        { status: 422 },
      );
    }

    const result = await postRedditReply({ submissionId, body: text });
    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          openUrl: url || `https://www.reddit.com/comments/${submissionId}/`,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      method: 'reddit',
      message: `Posted as u/${result.username}`,
      commentId: result.commentId,
      permalink: result.permalink,
      submissionId: result.submissionId,
      username: result.username,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'failed';
    console.error('[reply/submit]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
