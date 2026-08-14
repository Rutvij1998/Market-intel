/**
 * Role-based access for Market Vantage.
 *
 * - viewer:    full dashboard, no AI Reply
 * - responder: dashboard + AI Reply module
 * - admin:     responder + ops (job logs / sync)
 *
 * Grant via Supabase `dashboard_auth.role` and/or REPLY_ALLOWED_EMAILS env.
 */

import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/sessionAuth';

export type DashboardRole = 'viewer' | 'responder' | 'admin';

export type UserPermissions = {
  email: string;
  role: DashboardRole;
  canReply: boolean;
  canAdmin: boolean;
};

export const ROLE_RANK: Record<DashboardRole, number> = {
  viewer: 0,
  responder: 1,
  admin: 2,
};

export function isDashboardRole(value: unknown): value is DashboardRole {
  return value === 'viewer' || value === 'responder' || value === 'admin';
}

export function canUseReply(role: DashboardRole): boolean {
  return role === 'responder' || role === 'admin';
}

export function canUseAdmin(role: DashboardRole): boolean {
  return role === 'admin';
}

/** Comma/space-separated emails in REPLY_ALLOWED_EMAILS (or RESPONDER_EMAILS). */
export function replyAllowlistFromEnv(): Set<string> {
  const raw =
    process.env.REPLY_ALLOWED_EMAILS ||
    process.env.RESPONDER_EMAILS ||
    process.env.DASHBOARD_REPLY_EMAILS ||
    '';
  const set = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const e = part.trim().toLowerCase();
    if (e.endsWith('@likewize.com')) set.add(e);
  }
  return set;
}

/** Admin allowlist (optional). Falls back to reply list only if you set ADMIN_EMAILS. */
export function adminAllowlistFromEnv(): Set<string> {
  const raw = process.env.ADMIN_EMAILS || process.env.DASHBOARD_ADMIN_EMAILS || '';
  const set = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const e = part.trim().toLowerCase();
    if (e.endsWith('@likewize.com')) set.add(e);
  }
  return set;
}

/**
 * Resolve effective role for an email:
 * DB role (if any) merged with env allowlists (env can only upgrade, never demote).
 */
export async function resolveRoleForEmail(email: string): Promise<DashboardRole> {
  const normalized = email.trim().toLowerCase();
  let role: DashboardRole = 'viewer';

  if (supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin
        .from('dashboard_auth')
        .select('role')
        .eq('email', normalized)
        .maybeSingle();
      if (!error && data && isDashboardRole(data.role)) {
        role = data.role;
      }
    } catch {
      /* keep viewer */
    }
  }

  if (replyAllowlistFromEnv().has(normalized) && ROLE_RANK[role] < ROLE_RANK.responder) {
    role = 'responder';
  }
  if (adminAllowlistFromEnv().has(normalized) && ROLE_RANK[role] < ROLE_RANK.admin) {
    role = 'admin';
  }

  return role;
}

export function permissionsFor(email: string, role: DashboardRole): UserPermissions {
  return {
    email: email.trim().toLowerCase(),
    role,
    canReply: canUseReply(role),
    canAdmin: canUseAdmin(role),
  };
}

/** Session email from cookie (App Router server). */
export async function getSessionEmail(): Promise<string | null> {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    return verifySessionToken(token);
  } catch {
    return null;
  }
}

export async function getSessionPermissions(): Promise<UserPermissions | null> {
  const email = await getSessionEmail();
  if (!email) return null;
  const role = await resolveRoleForEmail(email);
  return permissionsFor(email, role);
}

/** From a Request (Route Handlers). */
export async function getRequestPermissions(
  request: Request,
): Promise<UserPermissions | null> {
  let token: string | undefined;
  // NextRequest exposes cookies.get
  const maybeCookies = (request as { cookies?: { get: (n: string) => { value: string } | undefined } })
    .cookies;
  if (maybeCookies?.get) {
    token = maybeCookies.get(SESSION_COOKIE)?.value;
  } else {
    const raw = request.headers.get('cookie') || '';
    for (const part of raw.split(';')) {
      const t = part.trim();
      if (t.startsWith(`${SESSION_COOKIE}=`)) {
        token = decodeURIComponent(t.slice(SESSION_COOKIE.length + 1));
        break;
      }
    }
  }
  const email = await verifySessionToken(token);
  if (!email) return null;
  const role = await resolveRoleForEmail(email);
  return permissionsFor(email, role);
}

export const REPLY_FORBIDDEN_MESSAGE =
  'You do not have access to the AI Reply module. Ask a Market Vantage admin to grant the responder role.';
