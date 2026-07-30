/**
 * Outbound email: SMTP (Gmail etc.) preferred when configured, else Resend API.
 * Attach PDF digests / screenshots for alert subscriptions.
 */

import nodemailer from 'nodemailer';

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
}

function smtpConfigured(): boolean {
  return !!(
    process.env.SMTP_HOST?.trim() &&
    process.env.SMTP_USER?.trim() &&
    process.env.SMTP_PASS?.trim()
  );
}

export function emailConfigured(): boolean {
  if (smtpConfigured()) return true;
  if (process.env.RESEND_API_KEY?.trim()) return true;
  return false;
}

function fromAddress(): string {
  return (
    process.env.EMAIL_FROM ||
    process.env.SMTP_FROM ||
    process.env.SMTP_USER ||
    'Market Vantage <onboarding@resend.dev>'
  );
}

export async function sendEmail(opts: SendEmailOptions): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  if (!emailConfigured()) {
    return {
      ok: false,
      error:
        'Email is not configured. Set SMTP_HOST / SMTP_USER / SMTP_PASS (+ EMAIL_FROM), or RESEND_API_KEY + EMAIL_FROM.',
    };
  }

  // Prefer SMTP when fully configured (e.g. Gmail) — works without a verified Resend domain
  if (smtpConfigured()) {
    return sendViaSmtp(opts);
  }
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) {
    return sendViaResend(opts, resendKey);
  }
  return { ok: false, error: 'No email transport configured' };
}

async function sendViaResend(
  opts: SendEmailOptions,
  apiKey: string,
): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  try {
    const body: Record<string, unknown> = {
      from: fromAddress(),
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text || stripHtml(opts.html),
    };
    if (opts.attachments?.length) {
      body.attachments = opts.attachments.map((a) => ({
        filename: a.filename,
        content: a.content.toString('base64'),
      }));
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      return { ok: false, error: json.message || `Resend HTTP ${res.status}` };
    }
    return { ok: true, id: json.id };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Resend send failed' };
  }
}

async function sendViaSmtp(
  opts: SendEmailOptions,
): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  try {
    const port = Number(process.env.SMTP_PORT || 587);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465 || process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        // Gmail App Passwords are often copied with spaces; strip them
        pass: (process.env.SMTP_PASS || '').replace(/\s+/g, ''),
      },
    });

    const info = await transporter.sendMail({
      from: fromAddress(),
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text || stripHtml(opts.html),
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType || 'application/pdf',
      })),
    });

    return { ok: true, id: info.messageId };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'SMTP send failed' };
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
