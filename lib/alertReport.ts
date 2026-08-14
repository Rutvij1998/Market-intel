/**
 * Match new mentions to alert subscriptions and build PDF + email digests.
 */

import PDFDocument from 'pdfkit';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail, emailConfigured } from '@/lib/email';
import {
  detectBusinessLine,
  formatBusinessLine,
  formatMentionSourceLabel,
  getMentionClient,
  normalizeClientLabel,
  type BusinessLine,
} from '@/lib/utils';
import {
  describeSubscriptionFilters,
  generateAlertInsights,
} from '@/lib/alertInsights';

export interface AlertSubscription {
  id: string;
  email: string;
  all_clients: boolean;
  clients: string[];
  all_business_lines: boolean;
  business_lines: string[];
  active: boolean;
  unsubscribe_token: string;
  last_notified_at: string | null;
  created_at?: string;
}

export interface AlertMentionRow {
  id?: string;
  reddit_id?: string;
  content?: string;
  text?: string;
  title?: string | null;
  url?: string | null;
  source?: string | null;
  subreddit?: string | null;
  company?: string | null;
  sentiment?: string | null;
  pillar?: string | null;
  created_at?: string;
  raw_data?: any;
  retailer?: string | null;
  retailer_context?: string | null;
}

function normalizeMention(row: AlertMentionRow) {
  const raw = row.raw_data || {};
  const text = row.content || row.text || '';
  const client = getMentionClient({
    client: row.retailer || raw.retailer_context || raw.client || row.subreddit || raw.subreddit,
    retailer_context: row.retailer || raw.retailer_context,
    subreddit: row.subreddit || raw.subreddit,
    source: row.source || raw.source,
    company: row.company || raw.company,
    id: row.reddit_id || row.id,
  });
  const business_line = detectBusinessLine({
    client,
    retailer_context: client,
    subreddit: row.subreddit || raw.subreddit,
    source: row.source || raw.source,
    text,
    title: row.title || undefined,
    full_thread: raw.full_thread,
    content: text,
  });
  return {
    id: String(row.reddit_id || row.id || ''),
    title: row.title || '',
    text,
    url: row.url || '',
    source: formatMentionSourceLabel(row.source || raw.source),
    client,
    business_line,
    businessLineLabel: formatBusinessLine(business_line),
    sentiment: row.sentiment || 'neutral',
    pillar: row.pillar || 'Other',
    created_at: row.created_at || new Date().toISOString(),
    company: row.company || raw.company || '',
  };
}

export type NormalizedAlertMention = ReturnType<typeof normalizeMention>;

function clientsEqual(a: string, b: string): boolean {
  const na = normalizeClientLabel(a).toLowerCase();
  const nb = normalizeClientLabel(b).toLowerCase();
  if (na === nb) return true;
  // soft contains for stored labels vs UI picks
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

export function subscriptionMatches(
  sub: AlertSubscription,
  m: NormalizedAlertMention,
): boolean {
  const clientOk =
    sub.all_clients ||
    (Array.isArray(sub.clients) && sub.clients.some((c) => clientsEqual(c, m.client)));
  const lineOk =
    sub.all_business_lines ||
    (Array.isArray(sub.business_lines) &&
      sub.business_lines.some(
        (l) => l.toLowerCase() === String(m.business_line).toLowerCase(),
      ));
  // Need at least one dimension configured
  const hasClientFilter = sub.all_clients || (sub.clients?.length ?? 0) > 0;
  const hasLineFilter = sub.all_business_lines || (sub.business_lines?.length ?? 0) > 0;
  if (!hasClientFilter && !hasLineFilter) return false;
  // When both dimensions are configured, require both (AND)
  if (hasClientFilter && hasLineFilter) return clientOk && lineOk;
  if (hasClientFilter) return clientOk;
  return lineOk;
}

export async function buildAlertPdf(opts: {
  email: string;
  matches: NormalizedAlertMention[];
  sub: AlertSubscription;
  since: string;
}): Promise<Buffer> {
  const { matches, sub, since } = opts;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const purple = '#3200BE';
    doc.fillColor(purple).fontSize(18).font('Helvetica-Bold').text('Market Vantage', { continued: false });
    doc.moveDown(0.3);
    doc.fillColor('#1a0b3d').fontSize(14).text('New thread alert report', { continued: false });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#5c5470').font('Helvetica');
    doc.text(`Generated: ${new Date().toUTCString()}`);
    doc.text(`Period: since ${new Date(since).toUTCString()}`);
    doc.text(`Matches: ${matches.length}`);
    doc.moveDown(0.4);

    const filterParts: string[] = [];
    if (sub.all_clients) filterParts.push('All clients');
    else if (sub.clients?.length) filterParts.push(`Clients: ${sub.clients.join(', ')}`);
    if (sub.all_business_lines) filterParts.push('All business lines');
    else if (sub.business_lines?.length) {
      filterParts.push(
        `Lines: ${sub.business_lines.map((l) => formatBusinessLine(l as BusinessLine) || l).join(', ')}`,
      );
    }
    doc.font('Helvetica-Bold').fillColor('#3200BE').text('Your filters (only these are included)');
    doc.font('Helvetica').fillColor('#1a0b3d').text(filterParts.join(' · ') || '—');
    doc.moveDown(0.8);

    if (!matches.length) {
      doc.text('No new matching threads for these filters in this period.');
      doc.end();
      return;
    }

    matches.forEach((m, i) => {
      if (doc.y > 700) doc.addPage();
      doc
        .font('Helvetica-Bold')
        .fillColor('#3200BE')
        .fontSize(11)
        .text(`${i + 1}. ${m.title || m.text.slice(0, 80) || 'Thread'}`, {
          width: 500,
        });
      doc.font('Helvetica').fontSize(9).fillColor('#5c5470');
      doc.text(
        `${m.source} · ${m.client} · ${m.businessLineLabel} · ${m.sentiment} · ${m.pillar}`,
      );
      doc.text(new Date(m.created_at).toLocaleString());
      doc.moveDown(0.25);
      doc.fillColor('#1a0b3d').fontSize(9).text((m.text || '').slice(0, 450), {
        width: 500,
        align: 'left',
      });
      if (m.url) {
        doc.fillColor('#3200BE').text(m.url, { link: m.url, underline: true, width: 500 });
      }
      doc.moveDown(0.7);
    });

    doc.fontSize(8).fillColor('#5c5470').text(
      'You are receiving this because you enrolled in Market Vantage alerts. Use the unsubscribe link in the email to stop.',
      48,
      doc.page.height - 60,
      { width: 500 },
    );

    doc.end();
  });
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  ).replace(/\/$/, '');
}

export async function processAlertDigests(opts?: {
  sinceHours?: number;
  /**
   * Manual "Send email now":
   * - ignore last_notified_at
   * - always email (even if zero matches in lookback) with live dashboard screenshot
   */
  force?: boolean;
  /** When set (UI send-now), only this subscription email is targeted */
  onlyEmail?: string;
  /**
   * Exact filters open on the dashboard when the user clicked Send.
   * Captures that view as full-page PNG + multi-page PDF.
   */
  viewSnapshot?: {
    tab: 'overview' | 'competitor';
    range: '7d' | '30d' | '90d' | 'All';
    client: string;
    source: string;
    businessLine: string;
  };
}): Promise<{
  ok: boolean;
  subscribers: number;
  emailsSent: number;
  errors: string[];
  emailConfigured: boolean;
}> {
  const errors: string[] = [];
  if (!supabaseAdmin) {
    return {
      ok: false,
      subscribers: 0,
      emailsSent: 0,
      errors: ['Supabase admin not configured'],
      emailConfigured: emailConfigured(),
    };
  }
  if (!emailConfigured()) {
    return {
      ok: false,
      subscribers: 0,
      emailsSent: 0,
      errors: [
        'Email not configured (RESEND_API_KEY or SMTP_*). Subscriptions saved but nothing sent.',
      ],
      emailConfigured: false,
    };
  }

  let subQuery = supabaseAdmin.from('alert_subscriptions').select('*').eq('active', true);
  if (opts?.onlyEmail?.trim()) {
    subQuery = subQuery.eq('email', opts.onlyEmail.trim().toLowerCase());
  }

  const { data: subs, error: subErr } = await subQuery;

  if (subErr) {
    return {
      ok: false,
      subscribers: 0,
      emailsSent: 0,
      errors: [subErr.message],
      emailConfigured: true,
    };
  }

  const list = (subs || []) as AlertSubscription[];
  if (!list.length) {
    return {
      ok: true,
      subscribers: 0,
      emailsSent: 0,
      errors: opts?.onlyEmail
        ? [`No active subscription for ${opts.onlyEmail}`]
        : [],
      emailConfigured: true,
    };
  }

  // Load recent mentions for the lookback window (cron uses 24h).
  // Per-subscriber, we still respect last_notified_at so we only email *new* matches.
  const sinceHours = opts?.sinceHours ?? 24;
  const defaultSince = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

  console.log(
    `[alerts] Loading mentions since ${defaultSince} (sinceHours=${sinceHours}, force=${!!opts?.force}, subscribers=${list.length})`,
  );

  const { data: rows, error: mentErr } = await supabaseAdmin
    .from('mentions')
    .select(
      'id, reddit_id, content, title, url, source, subreddit, company, sentiment, pillar, created_at, raw_data, retailer, retailer_context',
    )
    .gte('created_at', defaultSince)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (mentErr) {
    return {
      ok: false,
      subscribers: list.length,
      emailsSent: 0,
      errors: [mentErr.message],
      emailConfigured: true,
    };
  }

  const normalized = (rows || []).map((r) => normalizeMention(r as AlertMentionRow));
  let emailsSent = 0;
  const base = appBaseUrl();

  for (const sub of list) {
    // Only notify on NEW events since last send (or lookback window if never notified).
    // force=true ("Send email now") re-evaluates the full lookback window and always sends.
    const since =
      opts?.force || !sub.last_notified_at ? defaultSince : sub.last_notified_at;
    const matches = normalized
      .filter((m) => {
        if (new Date(m.created_at).getTime() < new Date(since).getTime()) return false;
        return subscriptionMatches(sub, m);
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Automatic path: no new matching thread → no email
    // Manual force: still send status + live screenshot
    if (!matches.length && !opts?.force) {
      console.log(`[alerts] No new events for ${sub.email} since ${since}`);
      continue;
    }

    try {
      const {
        captureDashboardScreenshots,
        screenshotsToPdf,
        dashboardUrlForSubscription,
        focusFromViewSnapshot,
        focusFromSubscription,
      } = await import('@/lib/dashboardScreenshot');

      const filterLabel = describeSubscriptionFilters(sub);

      // Clients that actually matched (already subscription-filtered)
      const clientCounts = new Map<string, number>();
      for (const m of matches) {
        clientCounts.set(m.client, (clientCounts.get(m.client) || 0) + 1);
      }
      const clientsInvolved = [...clientCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([c]) => c);
      const primaryClient =
        clientsInvolved[0] ||
        (!sub.all_clients && sub.clients?.length === 1 ? sub.clients[0] : undefined) ||
        'your filters';

      // Screenshots: exact UI snapshot if user clicked Send; else ALWAYS subscription filters
      // (never unfiltered “all clients” overview unless the sub is all_clients).
      let focus: import('@/lib/dashboardScreenshot').ScreenshotFocus;
      if (opts?.viewSnapshot) {
        focus = focusFromViewSnapshot(opts.viewSnapshot);
      } else {
        focus = focusFromSubscription(sub, {
          preferredClient: primaryClient !== 'your filters' ? primaryClient : undefined,
          range: 'All',
        });
      }

      console.log(
        `[alerts] ${sub.email} filters=${filterLabel} matches=${matches.length} ` +
          `shotFocus client=${focus.client || '(all)'} line=${focus.line || '(all)'} exact=${!!focus.exactSnapshot}`,
      );

      let shots: Awaited<ReturnType<typeof captureDashboardScreenshots>> = [];
      try {
        shots = await captureDashboardScreenshots(sub, focus);
      } catch (shotErr: any) {
        console.error('[alerts] screenshot capture failed (email still sending):', shotErr);
        const msg = String(shotErr?.message || shotErr);
        const short =
          msg.includes('browsers.json') || msg.includes('playwright')
            ? 'screenshot engine unavailable on host (email still sent with dashboard link)'
            : msg.slice(0, 160);
        errors.push(`${sub.email}: screenshot skipped — ${short}`);
      }

      // Dashboard PNG(s) → multi-page PDF
      let dashPdf: Buffer | null = null;
      if (shots.length) {
        try {
          dashPdf = await screenshotsToPdf(shots);
        } catch (pdfErr: any) {
          console.error('[alerts] dashboard PDF failed:', pdfErr);
          errors.push(`${sub.email}: dashboard PDF failed — PNG still attached if present`);
        }
      }

      // Thread list PDF for this subscriber's matches only
      let threadsPdf: Buffer | null = null;
      try {
        threadsPdf = await buildAlertPdf({
          email: sub.email,
          matches,
          sub,
          since,
        });
      } catch (tpErr: any) {
        console.error('[alerts] threads PDF failed:', tpErr);
      }

      // AI insights from filtered matches (+ filter names)
      const shotLabel = shots.map((s) => s.label).join('; ') || undefined;
      const { insights, provider: insightsProvider } = await generateAlertInsights({
        sub,
        matches: matches.map((m) => ({
          client: m.client,
          businessLineLabel: m.businessLineLabel,
          source: m.source,
          sentiment: m.sentiment,
          pillar: m.pillar,
          title: m.title || '',
          text: m.text || '',
        })),
        screenshotLabel: shotLabel,
      });

      const dashUrl = dashboardUrlForSubscription(sub, focus.tab || 'overview', focus);
      const unsubUrl = `${base}/api/notifications/unsubscribe?token=${encodeURIComponent(sub.unsubscribe_token)}`;
      const snapLabel = opts?.viewSnapshot
        ? [
            opts.viewSnapshot.tab,
            opts.viewSnapshot.range,
            opts.viewSnapshot.client !== 'All' ? opts.viewSnapshot.client : null,
            opts.viewSnapshot.businessLine !== 'All' ? opts.viewSnapshot.businessLine : null,
            opts.viewSnapshot.source !== 'All' ? opts.viewSnapshot.source : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : filterLabel;

      const { subject, html, text } = buildEventAlertEmail({
        matches,
        clientsInvolved:
          clientsInvolved.length > 0
            ? clientsInvolved
            : !sub.all_clients && sub.clients?.length
              ? sub.clients
              : ['All clients'],
        primaryClient,
        dashUrl,
        unsubUrl,
        hasPdf: !!(dashPdf || threadsPdf),
        shotCount: shots.length,
        manualSend: !!opts?.force,
        exactSnapshot: !!opts?.viewSnapshot,
        snapshotLabel: snapLabel,
        filterLabel,
        insights,
        insightsProvider,
      });

      const dateStamp = new Date().toISOString().slice(0, 10);
      const filterSlug = (primaryClient || 'filtered')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .slice(0, 40);
      const attachments = [
        ...(dashPdf
          ? [
              {
                filename: `market-vantage-dashboard-${filterSlug}-${dateStamp}.pdf`,
                content: dashPdf,
                contentType: 'application/pdf' as const,
              },
            ]
          : []),
        ...(threadsPdf
          ? [
              {
                filename: `market-vantage-threads-${filterSlug}-${dateStamp}.pdf`,
                content: threadsPdf,
                contentType: 'application/pdf' as const,
              },
            ]
          : []),
        ...shots.map((s) => ({
          filename: s.filename,
          content: s.buffer,
          contentType: 'image/png' as const,
        })),
      ];

      const sent = await sendEmail({
        to: sub.email,
        subject,
        html,
        text,
        attachments,
      });

      if (!sent.ok) {
        errors.push(`${sub.email}: ${sent.error}`);
        continue;
      }

      await supabaseAdmin
        .from('alert_subscriptions')
        .update({ last_notified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', sub.id);

      emailsSent += 1;
      console.log(
        `[alerts] Event alert → ${sub.email} (${matches.length} match(es), filters: ${filterLabel}, insights=${insightsProvider})`,
      );
    } catch (e: any) {
      errors.push(`${sub.email}: ${e?.message || 'send failed'}`);
    }
  }

  return {
    ok: errors.length === 0,
    subscribers: list.length,
    emailsSent,
    errors,
    emailConfigured: true,
  };
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Professional event-notification email (new thread detected or manual send). */
function buildEventAlertEmail(opts: {
  matches: NormalizedAlertMention[];
  clientsInvolved: string[];
  primaryClient: string;
  dashUrl: string;
  unsubUrl: string;
  hasPdf: boolean;
  shotCount: number;
  manualSend?: boolean;
  exactSnapshot?: boolean;
  snapshotLabel?: string;
  filterLabel?: string;
  insights?: string;
  insightsProvider?: 'xai' | 'rules';
}): { subject: string; html: string; text: string } {
  const {
    matches,
    clientsInvolved,
    primaryClient,
    dashUrl,
    unsubUrl,
    hasPdf,
    shotCount,
    manualSend,
    exactSnapshot,
    snapshotLabel,
    filterLabel,
    insights,
    insightsProvider,
  } = opts;
  const n = matches.length;
  const multiClient = clientsInvolved.length > 1;
  const clientPhrase = multiClient
    ? clientsInvolved.slice(0, 4).join(', ') + (clientsInvolved.length > 4 ? '…' : '')
    : primaryClient;
  const filtersShown = filterLabel || snapshotLabel || clientPhrase;

  const subject = exactSnapshot
    ? `Market Vantage | Intelligence brief · ${filtersShown}`
    : n === 0
      ? `Market Vantage | Quiet period · ${filtersShown}`
      : n === 1
        ? `Market Vantage | New conversation · ${primaryClient}`
        : multiClient
          ? `Market Vantage | ${n} conversations · ${clientPhrase}`
          : `Market Vantage | ${n} conversations · ${primaryClient}`;

  const headline =
    n === 0
      ? 'Intelligence brief — no new activity'
      : exactSnapshot
        ? 'Intelligence brief'
        : 'New activity requiring review';

  const intro =
    n === 0
      ? `Please find your scheduled Market Vantage brief for the monitoring criteria below.
          During this reporting period, <strong>no new public conversations</strong> met those criteria.
          Supporting materials reflect <strong>only</strong> your selected scope.`
      : exactSnapshot
        ? `Please find your Market Vantage intelligence brief, prepared from the dashboard view you requested
          ${snapshotLabel ? `(<em>${escapeHtml(snapshotLabel)}</em>)` : ''}.
          Analysis and attachments are limited to your monitoring criteria.`
        : `Please find your Market Vantage intelligence brief.
          We identified <strong>${n} new public conversation${n === 1 ? '' : 's'}</strong>
          within <strong>${escapeHtml(filtersShown)}</strong>
          ${multiClient ? ` (notably ${escapeHtml(clientPhrase)})` : ''}.
          Please review at your earliest convenience.`;

  const eventRows =
    n === 0
      ? `<tr><td style="padding:14px 0;color:#5c5470;font-size:14px;line-height:1.55">
          No conversations matched your monitoring criteria in this period.
          You may open the live dashboard to confirm filters or extend the date range.
        </td></tr>`
      : matches
          .slice(0, 8)
          .map((m, i) => {
            const title = m.title || m.text.slice(0, 90) || 'Untitled conversation';
            const when = new Date(m.created_at).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            });
            const excerpt = (m.text || '').replace(/\s+/g, ' ').trim().slice(0, 220);
            const link = m.url
              ? `<a href="${escapeHtml(m.url)}" style="color:#3200BE;font-size:12px">View source</a>`
              : '';
            return `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #ebe6f5;vertical-align:top">
            <div style="font-size:11px;color:#5c5470;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:4px">
              ${i + 1} · ${escapeHtml(m.client)} · ${escapeHtml(m.businessLineLabel)} · ${escapeHtml(m.source)}
            </div>
            <div style="font-size:15px;font-weight:600;color:#1a0b3d;margin-bottom:4px">${escapeHtml(title)}</div>
            <div style="font-size:12px;color:#5c5470;margin-bottom:6px">${escapeHtml(when)} · ${escapeHtml(m.sentiment)} · ${escapeHtml(m.pillar)}</div>
            ${excerpt ? `<div style="font-size:13px;color:#3d3555;line-height:1.45;margin-bottom:6px">${escapeHtml(excerpt)}${(m.text || '').length > 220 ? '…' : ''}</div>` : ''}
            ${link}
          </td>
        </tr>`;
          })
          .join('');

  const moreNote =
    n > 8
      ? `<p style="font-size:13px;color:#5c5470;margin-top:8px">${n - 8} additional conversation${n - 8 === 1 ? '' : 's'} available in the live dashboard.</p>`
      : '';

  const footerNote = exactSnapshot
    ? 'This brief was generated at your request and reflects the filters applied at the time of send.'
    : manualSend
      ? 'This brief was generated at your request from Market Vantage.'
      : 'This brief includes only activity since your previous automatic notification, within your selected criteria.';

  const attachmentNote =
    shotCount > 0
      ? `Enclosed: ${hasPdf ? 'PDF report(s) and ' : ''}${shotCount} dashboard image${shotCount === 1 ? '' : 's'} scoped to your criteria${
          n > 0 ? ', together with a conversation listing where applicable' : ''
        }.`
      : 'A live dashboard link is provided below. Visual capture was unavailable for this send.';

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f6f4fb">
  <div style="font-family:Georgia,'Times New Roman',serif;max-width:600px;margin:0 auto;padding:28px 16px">
    <div style="background:#ffffff;border-radius:12px;border:1px solid #e8e4f0;overflow:hidden">
      <div style="background:#3200BE;padding:22px 28px">
        <div style="font-family:system-ui,-apple-system,sans-serif;color:#ffffff;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;opacity:0.9">Market Vantage</div>
        <div style="font-family:system-ui,-apple-system,sans-serif;color:#ffffff;font-size:20px;font-weight:600;margin-top:6px;letter-spacing:-0.01em">${headline}</div>
      </div>
      <div style="padding:28px;color:#1a0b3d;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6">
          Dear colleague,
        </p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6">
          ${intro}
        </p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#faf8fc;border:1px solid #ebe6f5;border-radius:8px">
          <tr>
            <td style="padding:14px 16px">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#3200BE;margin-bottom:6px">Monitoring criteria</div>
              <div style="font-size:14px;line-height:1.5;color:#1a0b3d">${escapeHtml(filtersShown)}</div>
            </td>
          </tr>
        </table>

        ${
          insights
            ? `<div style="margin:0 0 22px;padding:18px 18px;background:#f6f2ff;border:1px solid #e0d6f7;border-radius:10px">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#3200BE;margin-bottom:10px">
            Executive insights${insightsProvider === 'xai' ? '' : ''}
          </div>
          <div style="font-size:14px;line-height:1.6;color:#1a0b3d;white-space:pre-wrap">${escapeHtml(insights)}</div>
        </div>`
            : ''
        }

        <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#3d3555">
          ${escapeHtml(attachmentNote)}
        </p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 24px">
          <tr>
            <td>
              <a href="${escapeHtml(dashUrl)}"
                 style="display:inline-block;background:#3200BE;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px">
                Open live dashboard
              </a>
            </td>
          </tr>
        </table>

        <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#3200BE;margin-bottom:6px">
          ${n === 0 ? 'Activity summary' : `Conversations in scope${n === 1 ? '' : ` (${Math.min(n, 8)} of ${n} shown)`}`}
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${eventRows}
        </table>
        ${moreNote}

        <p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#8a8299;word-break:break-all">
          Dashboard link<br/>
          <a href="${escapeHtml(dashUrl)}" style="color:#3200BE">${escapeHtml(dashUrl)}</a>
        </p>
      </div>
      <div style="padding:16px 28px;background:#faf8fc;border-top:1px solid #ebe6f5;font-family:system-ui,sans-serif;font-size:11px;color:#8a8299;line-height:1.55">
        You are receiving this message because you are enrolled in Market Vantage alerts for the monitoring criteria above.
        ${footerNote}
        <a href="${escapeHtml(unsubUrl)}" style="color:#3200BE">Unsubscribe</a>
      </div>
    </div>
  </div>
</body>
</html>`;

  const textLines = [
    'Market Vantage',
    headline,
    '',
    'Dear colleague,',
    '',
    n === 0
      ? `Please find your Market Vantage brief for the criteria below. No new public conversations met those criteria during this reporting period.`
      : `Please find your Market Vantage intelligence brief. ${n} new conversation${n === 1 ? '' : 's'} met your monitoring criteria.`,
    '',
    `Monitoring criteria: ${filtersShown}`,
    '',
    ...(insights ? ['Executive insights', insights, ''] : []),
    attachmentNote,
    '',
    `Live dashboard: ${dashUrl}`,
    '',
    ...(n
      ? [
          'Conversations in scope:',
          ...matches.slice(0, 8).map((m, i) => {
            const title = m.title || m.text.slice(0, 80) || 'Untitled';
            return `${i + 1}. [${m.client} · ${m.businessLineLabel} · ${m.source}] ${title}\n   ${m.url || ''}`.trim();
          }),
          '',
        ]
      : ['Activity summary: no conversations matched your criteria in this period.', '']),
    `Unsubscribe: ${unsubUrl}`,
  ];

  return { subject, html, text: textLines.join('\n') };
}
