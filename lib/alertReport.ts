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
  type BusinessLine,
} from '@/lib/utils';

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

export function subscriptionMatches(
  sub: AlertSubscription,
  m: NormalizedAlertMention,
): boolean {
  const clientOk =
    sub.all_clients ||
    (Array.isArray(sub.clients) &&
      sub.clients.some((c) => c.toLowerCase() === m.client.toLowerCase()));
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
    doc.font('Helvetica-Bold').fillColor('#3200BE').text('Your filters');
    doc.font('Helvetica').fillColor('#1a0b3d').text(filterParts.join(' · ') || '—');
    doc.moveDown(0.8);

    if (!matches.length) {
      doc.text('No new matching threads in this period.');
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

  // Load recent mentions (default lookback 48h, or since earliest last_notified)
  const sinceHours = opts?.sinceHours ?? 48;
  const defaultSince = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

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
      } = await import('@/lib/dashboardScreenshot');

      // Focus screenshot + deep-link on the primary client in this batch (e.g. Newegg, Rogers)
      const clientCounts = new Map<string, number>();
      for (const m of matches) {
        clientCounts.set(m.client, (clientCounts.get(m.client) || 0) + 1);
      }
      const clientsInvolved = [...clientCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([c]) => c);
      const primaryClient =
        clientsInvolved[0] ||
        (!sub.all_clients && sub.clients?.length === 1 ? sub.clients[0] : undefined);
      const primaryLine = matches.find((m) => m.client === primaryClient)?.business_line;
      const focus = primaryClient
        ? {
            client: primaryClient,
            line: primaryLine && primaryLine !== 'Other' ? String(primaryLine) : undefined,
            tab: 'overview' as const,
            range: '7d' as const,
            eventOnly: true as const,
          }
        : {
            tab: 'overview' as const,
            range: '7d' as const,
            eventOnly: false as const,
          };

      let shots: Awaited<ReturnType<typeof captureDashboardScreenshots>>;
      try {
        shots = await captureDashboardScreenshots(sub, focus);
      } catch (shotErr: any) {
        console.error('[alerts] screenshot capture failed:', shotErr);
        errors.push(
          `${sub.email}: live screenshot failed — ${shotErr?.message || shotErr}. Email not sent.`,
        );
        continue;
      }

      let pdf: Buffer | null = null;
      try {
        pdf = await screenshotsToPdf(shots);
      } catch (pdfErr: any) {
        console.error('[alerts] PDF embed failed (still sending PNGs):', pdfErr);
      }

      const dashUrl = dashboardUrlForSubscription(sub, 'overview', focus);
      const unsubUrl = `${base}/api/notifications/unsubscribe?token=${encodeURIComponent(sub.unsubscribe_token)}`;
      const { subject, html, text } = buildEventAlertEmail({
        matches,
        clientsInvolved,
        primaryClient: primaryClient || 'your monitored accounts',
        dashUrl,
        unsubUrl,
        hasPdf: !!pdf,
        shotCount: shots.length,
        manualSend: !!opts?.force,
      });

      const attachments = [
        ...shots.map((s) => ({
          filename: s.filename,
          content: s.buffer,
          contentType: 'image/png' as const,
        })),
        ...(pdf
          ? [
              {
                filename: `market-vantage-event-${new Date().toISOString().slice(0, 10)}.pdf`,
                content: pdf,
                contentType: 'application/pdf' as const,
              },
            ]
          : []),
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
        `[alerts] Event alert → ${sub.email} (${matches.length} new thread(s), clients: ${clientsInvolved.join(', ')})`,
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
  } = opts;
  const n = matches.length;
  const multiClient = clientsInvolved.length > 1;
  const clientPhrase = multiClient
    ? clientsInvolved.slice(0, 4).join(', ') + (clientsInvolved.length > 4 ? '…' : '')
    : primaryClient;

  const subject =
    n === 0
      ? `Market Vantage | Dashboard report (no new events in window)`
      : n === 1
        ? `Market Vantage | New activity detected for ${primaryClient}`
        : multiClient
          ? `Market Vantage | ${n} new events across ${clientPhrase}`
          : `Market Vantage | ${n} new events detected for ${primaryClient}`;

  const headline =
    n === 0
      ? 'Dashboard status report'
      : 'New activity requires your attention';

  const intro =
    n === 0
      ? `This is a <strong>manual status report</strong> you requested from Market Vantage. There were <strong>no new matching conversations</strong> in the recent lookback window for your filters. A live screenshot of the dashboard is attached for your review.`
      : `We have detected <strong>${n} new public conversation${n === 1 ? '' : 's'}</strong>
          matching your alert criteria
          ${multiClient ? ` across <strong>${escapeHtml(clientPhrase)}</strong>` : ` for <strong>${escapeHtml(primaryClient)}</strong>`}.
          Please review ${n === 1 ? 'this event' : 'these events'} at your earliest convenience.`;

  const eventRows =
    n === 0
      ? `<tr><td style="padding:14px 0;color:#5c5470;font-size:14px;line-height:1.5">No matching events in this period. Open the dashboard to browse the full dataset and adjust filters if needed.</td></tr>`
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
              ? `<a href="${escapeHtml(m.url)}" style="color:#3200BE;font-size:12px">View source thread</a>`
              : '';
            return `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #ebe6f5;vertical-align:top">
            <div style="font-size:11px;color:#5c5470;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:4px">
              Event ${i + 1} · ${escapeHtml(m.client)} · ${escapeHtml(m.businessLineLabel)} · ${escapeHtml(m.source)}
            </div>
            <div style="font-size:15px;font-weight:600;color:#1a0b3d;margin-bottom:4px">${escapeHtml(title)}</div>
            <div style="font-size:12px;color:#5c5470;margin-bottom:6px">${escapeHtml(when)} · Sentiment: ${escapeHtml(m.sentiment)} · ${escapeHtml(m.pillar)}</div>
            ${excerpt ? `<div style="font-size:13px;color:#3d3555;line-height:1.45;margin-bottom:6px">${escapeHtml(excerpt)}${(m.text || '').length > 220 ? '…' : ''}</div>` : ''}
            ${link}
          </td>
        </tr>`;
          })
          .join('');

  const moreNote =
    n > 8
      ? `<p style="font-size:13px;color:#5c5470;margin-top:8px">Plus ${n - 8} additional matching event${n - 8 === 1 ? '' : 's'} — open the dashboard for the full list.</p>`
      : '';

  const footerNote = manualSend
    ? 'You requested this email using “Send email now” in Market Vantage.'
    : 'Only new activity since your last automatic notification is included.';

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f6f4fb">
  <div style="font-family:Georgia,'Times New Roman',serif;max-width:600px;margin:0 auto;padding:28px 16px">
    <div style="background:#ffffff;border-radius:12px;border:1px solid #e8e4f0;overflow:hidden">
      <div style="background:#3200BE;padding:20px 28px">
        <div style="font-family:system-ui,-apple-system,sans-serif;color:#ffffff;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9">Market Vantage</div>
        <div style="font-family:system-ui,-apple-system,sans-serif;color:#ffffff;font-size:20px;font-weight:600;margin-top:4px">${headline}</div>
      </div>
      <div style="padding:28px;color:#1a0b3d;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55">
          Hello,
        </p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55">
          ${intro}
        </p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#3d3555">
          A live screenshot of the Market Vantage dashboard${n > 0 ? ' — filtered to this context —' : ''} is attached
          so you can assess the situation quickly. You may also open the interactive dashboard using the button below.
        </p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px">
          <tr>
            <td>
              <a href="${escapeHtml(dashUrl)}"
                 style="display:inline-block;background:#3200BE;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px">
                Open dashboard · Review
              </a>
            </td>
          </tr>
        </table>

        <div style="font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#3200BE;margin-bottom:4px">
          ${n === 0 ? 'Status' : `Event detail${n === 1 ? '' : 's'}`}
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${eventRows}
        </table>
        ${moreNote}

        <p style="margin:22px 0 0;font-size:13px;line-height:1.5;color:#5c5470">
          Attachments: ${shotCount} live dashboard screenshot${shotCount === 1 ? '' : 's'} (PNG)
          ${hasPdf ? ' and a PDF of the same capture' : ''}.
        </p>
        <p style="margin:10px 0 0;font-size:12px;line-height:1.5;color:#8a8299;word-break:break-all">
          Direct link:<br/>
          <a href="${escapeHtml(dashUrl)}" style="color:#3200BE">${escapeHtml(dashUrl)}</a>
        </p>
      </div>
      <div style="padding:16px 28px;background:#faf8fc;border-top:1px solid #ebe6f5;font-family:system-ui,sans-serif;font-size:11px;color:#8a8299;line-height:1.5">
        You are receiving this because you enrolled in Market Vantage event alerts for matching clients and business lines.
        ${footerNote}
        <a href="${escapeHtml(unsubUrl)}" style="color:#3200BE">Unsubscribe</a>
      </div>
    </div>
  </div>
</body>
</html>`;

  const textLines = [
    `Market Vantage — ${headline}`,
    '',
    n === 0
      ? 'Manual status report: no new matching conversations in the lookback window. Live dashboard screenshot attached.'
      : `We have detected ${n} new public conversation${n === 1 ? '' : 's'} matching your alert criteria for ${clientPhrase}. Please review at your earliest convenience.`,
    '',
    `Dashboard: ${dashUrl}`,
    '',
    ...(n
      ? [
          'Events:',
          ...matches.slice(0, 8).map((m, i) => {
            const title = m.title || m.text.slice(0, 80) || 'Untitled';
            return `${i + 1}. [${m.client} · ${m.businessLineLabel} · ${m.source}] ${title}\n   ${m.url || ''}`.trim();
          }),
          '',
        ]
      : []),
    `A live screenshot of the dashboard is attached (${shotCount} PNG${shotCount === 1 ? '' : 's'}${hasPdf ? ' + PDF' : ''}).`,
    '',
    `Unsubscribe: ${unsubUrl}`,
  ];

  return { subject, html, text: textLines.join('\n') };
}
