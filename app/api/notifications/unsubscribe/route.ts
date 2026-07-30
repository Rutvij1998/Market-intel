import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token')?.trim();
  if (!token || !supabaseAdmin) {
    return new NextResponse(htmlPage('Invalid link', 'This unsubscribe link is missing or invalid.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const { data, error } = await supabaseAdmin
    .from('alert_subscriptions')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('unsubscribe_token', token)
    .select('email')
    .maybeSingle();

  if (error || !data) {
    return new NextResponse(
      htmlPage('Not found', 'We could not find an active subscription for this link.'),
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  return new NextResponse(
    htmlPage(
      'Unsubscribed',
      `Alerts for <strong>${escape(data.email)}</strong> have been turned off. You can re-enroll anytime from the Market Vantage dashboard.`,
    ),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

function escape(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function htmlPage(title: string, body: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title} · Market Vantage</title>
  <style>body{font-family:system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#1a0b3d}
  h1{color:#3200BE;font-size:1.35rem}p{color:#5c5470;line-height:1.5}a{color:#3200BE}</style></head>
  <body><h1>${title}</h1><p>${body}</p><p><a href="/">Back to Market Vantage</a></p></body></html>`;
}
