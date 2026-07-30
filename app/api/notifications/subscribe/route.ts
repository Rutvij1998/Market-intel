import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { emailConfigured } from '@/lib/email';
import { BusinessLines, type BusinessLine } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function randomToken(): string {
  const a = crypto.randomUUID().replace(/-/g, '');
  const b = crypto.randomUUID().replace(/-/g, '');
  return a + b;
}

/**
 * POST — create or update alert subscription
 * Body: { email, all_clients, clients[], all_business_lines, business_lines[] }
 */
export async function POST(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  let body: {
    email?: string;
    all_clients?: boolean;
    clients?: string[];
    all_business_lines?: boolean;
    business_lines?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!validEmail(email)) {
    return NextResponse.json({ ok: false, error: 'Enter a valid email address.' }, { status: 400 });
  }

  const all_clients = !!body.all_clients;
  const all_business_lines = !!body.all_business_lines;
  const clients = Array.isArray(body.clients)
    ? [...new Set(body.clients.map((c) => String(c).trim()).filter(Boolean))]
    : [];
  const business_lines = Array.isArray(body.business_lines)
    ? [
        ...new Set(
          body.business_lines
            .map((l) => String(l).trim())
            .filter((l): l is BusinessLine => (BusinessLines as readonly string[]).includes(l)),
        ),
      ]
    : [];

  if (!all_clients && clients.length === 0 && !all_business_lines && business_lines.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Select at least one client, one business line, or “All” for either.',
      },
      { status: 400 },
    );
  }

  const row = {
    email,
    all_clients,
    clients,
    all_business_lines,
    business_lines,
    active: true,
    updated_at: new Date().toISOString(),
    unsubscribe_token: randomToken(),
  };

  // Upsert by email (case-insensitive unique index on lower(email) — use email as conflict if unique on email)
  // Our unique index is on lower(email); PostgREST upsert may need onConflict: 'email' if we have unique on email.
  // We only have unique index on lower(email), not a constraint on email column.
  // So: try select existing, then update or insert.

  const { data: existing } = await supabaseAdmin
    .from('alert_subscriptions')
    .select('id, unsubscribe_token')
    .ilike('email', email)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await supabaseAdmin
      .from('alert_subscriptions')
      .update({
        all_clients,
        clients,
        all_business_lines,
        business_lines,
        active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id, email, all_clients, clients, all_business_lines, business_lines, active')
      .maybeSingle();

    if (error) {
      if (error.code === '42P01' || /does not exist/i.test(error.message)) {
        return NextResponse.json(
          {
            ok: false,
            error:
              'alert_subscriptions table missing. Run supabase/migrations/003_alert_subscriptions.sql in Supabase.',
          },
          { status: 503 },
        );
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      updated: true,
      subscription: data,
      emailConfigured: emailConfigured(),
      message: emailConfigured()
        ? 'Subscription updated. You will get email PDF digests when new matching threads appear.'
        : 'Subscription saved, but email is not configured on the server yet (RESEND_API_KEY or SMTP).',
    });
  }

  const { data, error } = await supabaseAdmin
    .from('alert_subscriptions')
    .insert(row)
    .select('id, email, all_clients, clients, all_business_lines, business_lines, active')
    .maybeSingle();

  if (error) {
    if (error.code === '42P01' || /does not exist/i.test(error.message)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'alert_subscriptions table missing. Run supabase/migrations/003_alert_subscriptions.sql in Supabase.',
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    created: true,
    subscription: data,
    emailConfigured: emailConfigured(),
    message: emailConfigured()
      ? 'You are enrolled. New matching threads will arrive by email with a PDF report.'
      : 'Enrolled in the database, but email is not configured on the server yet (RESEND_API_KEY or SMTP).',
  });
}

/** GET ?email= — load existing subscription for the form */
export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }
  const email = (new URL(request.url).searchParams.get('email') || '').trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ ok: true, subscription: null, emailConfigured: emailConfigured() });
  }

  const { data, error } = await supabaseAdmin
    .from('alert_subscriptions')
    .select(
      'id, email, all_clients, clients, all_business_lines, business_lines, active, last_notified_at, created_at',
    )
    .ilike('email', email)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({
        ok: true,
        subscription: null,
        tableMissing: true,
        emailConfigured: emailConfigured(),
      });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    subscription: data,
    emailConfigured: emailConfigured(),
  });
}
