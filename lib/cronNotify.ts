/**
 * Ops email for cron jobs.
 * Failures: always email CRON_NOTIFY_EMAIL.
 * Success ingest: no email.
 * Alert digests: daily delivery report (who received what), not a generic OK ping.
 */

import { emailConfigured, sendEmail } from '@/lib/email';

export type CronNotifyStatus = 'success' | 'error';

export type AlertDeliveryRow = {
  email: string;
  sent: boolean;
  filterLabel: string;
  matchCount: number;
  clients: string[];
  subject?: string;
  sampleTitles?: string[];
  skipReason?: string;
  error?: string;
};

export type CronNotifyPayload = {
  jobName: string;
  status: CronNotifyStatus;
  message?: string | null;
  error?: string | null;
  details?: Record<string, unknown> | null;
  durationMs?: number | null;
  jobRunId?: string | null;
};

function notifyRecipients(): string[] {
  const raw =
    process.env.CRON_NOTIFY_EMAIL ||
    process.env.OPS_NOTIFY_EMAIL ||
    process.env.ADMIN_NOTIFY_EMAIL ||
    '';
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@'));
}

function formatDuration(ms?: number | null): string {
  if (ms == null || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}m ${rem}s` : `${min}m`;
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Fire-and-forget style but awaited so Vercel doesn't kill mid-send.
 * Never throws — logs and returns.
 * Success pings are skipped — only failures go out.
 */
export async function notifyCronOutcome(payload: CronNotifyPayload): Promise<void> {
  if (payload.status !== 'error') {
    console.log(`[cronNotify] skip success email (${payload.jobName})`);
    return;
  }

  const recipients = notifyRecipients();
  if (!recipients.length) {
    console.warn('[cronNotify] CRON_NOTIFY_EMAIL not set — skip ops email');
    return;
  }
  if (!emailConfigured()) {
    console.warn('[cronNotify] Email transport not configured — skip ops email');
    return;
  }

  const when = new Date().toUTCString();
  const subject = `Market Vantage · FAILED · ${payload.jobName}`;

  const detailLines = payload.details
    ? Object.entries(payload.details)
        .slice(0, 20)
        .map(([k, v]) => {
          let val: string;
          try {
            val = typeof v === 'string' ? v : JSON.stringify(v);
          } catch {
            val = String(v);
          }
          return `${k}: ${val}`.slice(0, 300);
        })
    : [];

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f6f4fb;font-family:system-ui,-apple-system,sans-serif">
  <div style="max-width:560px;margin:24px auto;background:#fff;border:1px solid #e8e4f0;border-radius:12px;overflow:hidden">
    <div style="background:#b91c1c;padding:16px 22px;color:#fff">
      <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9">Market Vantage · Cron</div>
      <div style="font-size:18px;font-weight:600;margin-top:4px">Job failed</div>
    </div>
    <div style="padding:22px;color:#1a0b3d;font-size:14px;line-height:1.55">
      <p style="margin:0 0 12px"><strong>Job:</strong> ${escapeHtml(payload.jobName)}</p>
      <p style="margin:0 0 12px"><strong>Status:</strong> Error</p>
      <p style="margin:0 0 12px"><strong>When (UTC):</strong> ${escapeHtml(when)}</p>
      <p style="margin:0 0 12px"><strong>Duration:</strong> ${escapeHtml(formatDuration(payload.durationMs))}</p>
      ${payload.message ? `<p style="margin:0 0 12px"><strong>Message:</strong> ${escapeHtml(payload.message)}</p>` : ''}
      ${payload.error ? `<p style="margin:0 0 12px;color:#b91c1c"><strong>Error:</strong> ${escapeHtml(payload.error)}</p>` : ''}
      ${payload.jobRunId ? `<p style="margin:0 0 12px"><strong>Run ID:</strong> <code style="font-size:12px">${escapeHtml(payload.jobRunId)}</code></p>` : ''}
      ${
        detailLines.length
          ? `<div style="margin-top:16px;padding:12px;background:#faf8fc;border-radius:8px;font-size:12px;color:#5c5470">
        <div style="font-weight:600;margin-bottom:6px;color:#3200BE">Details</div>
        <pre style="margin:0;white-space:pre-wrap;font-family:ui-monospace,monospace">${escapeHtml(detailLines.join('\n'))}</pre>
      </div>`
          : ''
      }
    </div>
  </div>
</body>
</html>`.trim();

  const text = [
    `Market Vantage cron: FAILED`,
    `Job: ${payload.jobName}`,
    `Status: ${payload.status}`,
    `When (UTC): ${when}`,
    `Duration: ${formatDuration(payload.durationMs)}`,
    payload.message ? `Message: ${payload.message}` : '',
    payload.error ? `Error: ${payload.error}` : '',
    payload.jobRunId ? `Run ID: ${payload.jobRunId}` : '',
    detailLines.length ? `Details:\n${detailLines.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  for (const to of recipients) {
    const sent = await sendEmail({ to, subject, html, text });
    if (!sent.ok) {
      console.error(`[cronNotify] failed → ${to}:`, sent.error);
    } else {
      console.log(`[cronNotify] ${payload.status} email → ${to} (${payload.jobName})`);
    }
  }
}

function formatClients(clients: string[]): string {
  if (!clients.length) return '—';
  const shown = clients.slice(0, 6);
  return shown.join(', ') + (clients.length > 6 ? ` +${clients.length - 6}` : '');
}

/**
 * Daily ops email: which subscribers were sent an alert, and what it covered.
 */
export async function notifyAlertDeliveryReport(opts: {
  deliveries: AlertDeliveryRow[];
  sinceHours: number;
  durationMs?: number | null;
  jobRunId?: string | null;
}): Promise<void> {
  const recipients = notifyRecipients();
  if (!recipients.length) {
    console.warn('[cronNotify] CRON_NOTIFY_EMAIL not set — skip delivery report');
    return;
  }
  if (!emailConfigured()) {
    console.warn('[cronNotify] Email transport not configured — skip delivery report');
    return;
  }

  const sent = opts.deliveries.filter((d) => d.sent);
  const skipped = opts.deliveries.filter((d) => !d.sent && !d.error);
  const failed = opts.deliveries.filter((d) => !d.sent && d.error);
  const when = new Date().toUTCString();
  const dateStamp = new Date().toISOString().slice(0, 10);
  const subject =
    sent.length > 0
      ? `Market Vantage · Alert delivery · ${sent.length} subscriber${sent.length === 1 ? '' : 's'} · ${dateStamp}`
      : `Market Vantage · Alert delivery · none sent · ${dateStamp}`;

  const rowHtml = (d: AlertDeliveryRow) => {
    const titles = (d.sampleTitles || []).slice(0, 3).map((t) => escapeHtml(t)).join('<br/>');
    return `<tr>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top">${escapeHtml(d.email)}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top">${escapeHtml(d.filterLabel || '—')}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top">${d.matchCount}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top">${escapeHtml(formatClients(d.clients))}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top;font-size:12px;color:#5c5470">${
        d.sent
          ? escapeHtml(d.subject || 'Alert sent')
          : d.error
            ? `<span style="color:#b91c1c">${escapeHtml(d.error)}</span>`
            : escapeHtml(d.skipReason || 'Not sent')
      }${titles ? `<div style="margin-top:6px">${titles}</div>` : ''}</td>
    </tr>`;
  };

  const table = (rows: AlertDeliveryRow[], empty: string) =>
    rows.length
      ? `<table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="text-align:left;color:#5c5470">
              <th style="padding:8px;border-bottom:2px solid #e8e4f0">Subscriber</th>
              <th style="padding:8px;border-bottom:2px solid #e8e4f0">Alert filters</th>
              <th style="padding:8px;border-bottom:2px solid #e8e4f0">Threads</th>
              <th style="padding:8px;border-bottom:2px solid #e8e4f0">Clients</th>
              <th style="padding:8px;border-bottom:2px solid #e8e4f0">What was sent</th>
            </tr>
          </thead>
          <tbody>${rows.map(rowHtml).join('')}</tbody>
        </table>`
      : `<p style="margin:0;color:#5c5470;font-size:13px">${escapeHtml(empty)}</p>`;

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f6f4fb;font-family:system-ui,-apple-system,sans-serif">
  <div style="max-width:720px;margin:24px auto;background:#fff;border:1px solid #e8e4f0;border-radius:12px;overflow:hidden">
    <div style="background:#3200BE;padding:16px 22px;color:#fff">
      <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9">Market Vantage · Alert delivery</div>
      <div style="font-size:18px;font-weight:600;margin-top:4px">${sent.length} subscriber${sent.length === 1 ? '' : 's'} received an alert</div>
    </div>
    <div style="padding:22px;color:#1a0b3d;font-size:14px;line-height:1.55">
      <p style="margin:0 0 12px"><strong>When (UTC):</strong> ${escapeHtml(when)}</p>
      <p style="margin:0 0 12px"><strong>Window:</strong> last ${opts.sinceHours}h${opts.durationMs != null ? ` · ran in ${escapeHtml(formatDuration(opts.durationMs))}` : ''}</p>
      <p style="margin:0 0 18px"><strong>Sent:</strong> ${sent.length} · <strong>Skipped (no new matches):</strong> ${skipped.length} · <strong>Failed:</strong> ${failed.length}</p>
      <h3 style="margin:0 0 10px;font-size:14px;color:#3200BE">Received an alert</h3>
      ${table(sent, 'Nobody received an alert this run.')}
      ${
        failed.length
          ? `<h3 style="margin:22px 0 10px;font-size:14px;color:#b91c1c">Failed to send</h3>${table(failed, '')}`
          : ''
      }
      ${
        skipped.length
          ? `<h3 style="margin:22px 0 10px;font-size:14px;color:#5c5470">Not sent (no new matching threads)</h3>${table(skipped, '')}`
          : ''
      }
      ${opts.jobRunId ? `<p style="margin:18px 0 0;font-size:12px;color:#5c5470">Run ID: <code>${escapeHtml(opts.jobRunId)}</code></p>` : ''}
    </div>
  </div>
</body>
</html>`.trim();

  const textLines = [
    `Market Vantage alert delivery · ${dateStamp}`,
    `When (UTC): ${when}`,
    `Window: last ${opts.sinceHours}h`,
    `Sent: ${sent.length} · Skipped: ${skipped.length} · Failed: ${failed.length}`,
    '',
    sent.length ? 'Received an alert:' : 'Nobody received an alert this run.',
    ...sent.map(
      (d) =>
        `- ${d.email} | ${d.filterLabel} | ${d.matchCount} thread(s) | ${formatClients(d.clients)} | ${d.subject || ''}`,
    ),
    ...(failed.length
      ? ['', 'Failed:', ...failed.map((d) => `- ${d.email}: ${d.error}`)]
      : []),
    ...(skipped.length
      ? ['', 'Not sent:', ...skipped.map((d) => `- ${d.email}: ${d.skipReason || 'no new matches'}`)]
      : []),
  ];

  for (const to of recipients) {
    const result = await sendEmail({ to, subject, html, text: textLines.join('\n') });
    if (!result.ok) {
      console.error(`[cronNotify] delivery report failed → ${to}:`, result.error);
    } else {
      console.log(`[cronNotify] delivery report → ${to} (sent=${sent.length})`);
    }
  }
}
