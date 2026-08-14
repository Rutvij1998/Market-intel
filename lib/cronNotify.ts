/**
 * Ops email after cron / scheduled jobs finish (success or error).
 * Set CRON_NOTIFY_EMAIL (comma-separated allowed). Defaults to a single recipient if set.
 */

import { emailConfigured, sendEmail } from '@/lib/email';

export type CronNotifyStatus = 'success' | 'error';

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
 */
export async function notifyCronOutcome(payload: CronNotifyPayload): Promise<void> {
  const recipients = notifyRecipients();
  if (!recipients.length) {
    console.warn('[cronNotify] CRON_NOTIFY_EMAIL not set — skip ops email');
    return;
  }
  if (!emailConfigured()) {
    console.warn('[cronNotify] Email transport not configured — skip ops email');
    return;
  }

  const ok = payload.status === 'success';
  const when = new Date().toUTCString();
  const subject = ok
    ? `Market Vantage · OK · ${payload.jobName}`
    : `Market Vantage · FAILED · ${payload.jobName}`;

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
    <div style="background:${ok ? '#0f766e' : '#b91c1c'};padding:16px 22px;color:#fff">
      <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9">Market Vantage · Cron</div>
      <div style="font-size:18px;font-weight:600;margin-top:4px">${ok ? 'Job completed successfully' : 'Job failed'}</div>
    </div>
    <div style="padding:22px;color:#1a0b3d;font-size:14px;line-height:1.55">
      <p style="margin:0 0 12px"><strong>Job:</strong> ${escapeHtml(payload.jobName)}</p>
      <p style="margin:0 0 12px"><strong>Status:</strong> ${ok ? 'Success' : 'Error'}</p>
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
    `Market Vantage cron: ${ok ? 'SUCCESS' : 'FAILED'}`,
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
