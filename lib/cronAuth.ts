/**
 * Shared auth for cron / scheduled endpoints.
 *
 * Vercel Cron automatically sends:
 *   Authorization: Bearer <CRON_SECRET>
 * when CRON_SECRET is set on the project.
 *
 * Also accepts ?secret= for manual / external cron triggers.
 */

export type CronAuthResult =
  | { ok: true; mode: 'open' | 'bearer' | 'query' | 'vercel-cron' }
  | { ok: false; reason: string };

function extractBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = authHeader.trim().match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

/** Trim + strip surrounding quotes (common when pasting secrets into Vercel UI). */
export function normalizeCronSecret(value: string | undefined | null): string {
  if (!value) return '';
  let s = value.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  // Env files / dashboard sometimes inject a trailing newline
  return s.replace(/\r?\n/g, '').trim();
}

/**
 * Verify the request is allowed to run a cron job.
 * - If CRON_SECRET is unset: allow (local / simple deploys).
 * - If set: require matching Bearer token or ?secret= query param.
 * - Also accept Vercel cron user-agent when Authorization matches (logged as vercel-cron).
 */
export function verifyCronAuth(request: Request): CronAuthResult {
  const cronSecret = normalizeCronSecret(process.env.CRON_SECRET);
  if (!cronSecret) {
    return { ok: true, mode: 'open' };
  }

  const authHeader = request.headers.get('authorization');
  const bearer = extractBearer(authHeader);
  const querySecret = new URL(request.url).searchParams.get('secret')?.trim() || null;
  const ua = request.headers.get('user-agent') || '';
  const isVercelCron = /vercel-cron/i.test(ua);

  if (bearer && bearer === cronSecret) {
    return { ok: true, mode: isVercelCron ? 'vercel-cron' : 'bearer' };
  }
  if (querySecret && querySecret === cronSecret) {
    return { ok: true, mode: 'query' };
  }

  // Helpful reasons for logs / admin diagnostics (never include secret values)
  if (!bearer && !querySecret) {
    return {
      ok: false,
      reason: isVercelCron
        ? 'Vercel cron request missing Authorization Bearer (CRON_SECRET may not be set on this deployment env)'
        : 'Missing Authorization Bearer or ?secret= (CRON_SECRET is configured)',
    };
  }
  return {
    ok: false,
    reason: 'CRON_SECRET mismatch (check for quotes/newlines in Vercel env; redeploy after changing)',
  };
}

export function unauthorizedCronResponse(reason: string): Response {
  return new Response(`Unauthorized: ${reason}`, {
    status: 401,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/** Non-secret diagnostics for the admin panel. */
export function cronAuthDiagnostics() {
  const secret = normalizeCronSecret(process.env.CRON_SECRET);
  return {
    cronSecretConfigured: secret.length > 0,
    cronSecretLength: secret.length,
    // Vercel sets this on its own platform
    onVercel: process.env.VERCEL === '1',
    vercelEnv: process.env.VERCEL_ENV || null,
  };
}
