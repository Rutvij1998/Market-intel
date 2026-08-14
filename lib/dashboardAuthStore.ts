/**
 * Persist dashboard login email + authentication status + role in Supabase.
 * Failures are logged but never block sign-in / sign-out.
 */

import {
  adminAllowlistFromEnv,
  isDashboardRole,
  replyAllowlistFromEnv,
  type DashboardRole,
  ROLE_RANK,
} from '@/lib/roles';
import { supabaseAdmin } from '@/lib/supabase';

export interface DashboardAuthRow {
  id: string;
  email: string;
  authenticated: boolean;
  role?: DashboardRole | string;
  last_login_at?: string | null;
  last_logout_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

function bootstrapRoleForEmail(email: string, existing?: DashboardRole | null): DashboardRole {
  let role: DashboardRole = existing && isDashboardRole(existing) ? existing : 'viewer';
  if (replyAllowlistFromEnv().has(email) && ROLE_RANK[role] < ROLE_RANK.responder) {
    role = 'responder';
  }
  if (adminAllowlistFromEnv().has(email) && ROLE_RANK[role] < ROLE_RANK.admin) {
    role = 'admin';
  }
  return role;
}

/** Upsert email with authenticated = true after successful OTP. */
export async function markUserAuthenticated(email: string): Promise<void> {
  if (!supabaseAdmin) {
    console.warn('[dashboardAuth] supabaseAdmin not configured — skip login record');
    return;
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized.endsWith('@likewize.com')) return;

  const now = new Date().toISOString();

  try {
    // Preserve an elevated role already set in SQL; env can only upgrade
    let existingRole: DashboardRole | null = null;
    const { data: existing } = await supabaseAdmin
      .from('dashboard_auth')
      .select('role')
      .eq('email', normalized)
      .maybeSingle();
    if (existing && isDashboardRole(existing.role)) {
      existingRole = existing.role;
    }

    const role = bootstrapRoleForEmail(normalized, existingRole);

    const { error } = await supabaseAdmin.from('dashboard_auth').upsert(
      {
        email: normalized,
        authenticated: true,
        role,
        last_login_at: now,
        updated_at: now,
      },
      { onConflict: 'email' },
    );

    if (error) {
      // Older DBs before migration 006 may lack `role` — retry without it
      if (/role|column/i.test(error.message || '')) {
        const { error: e2 } = await supabaseAdmin.from('dashboard_auth').upsert(
          {
            email: normalized,
            authenticated: true,
            last_login_at: now,
            updated_at: now,
          },
          { onConflict: 'email' },
        );
        if (e2) console.error('[dashboardAuth] mark authenticated failed:', e2.message);
        else console.warn('[dashboardAuth] role column missing — run migration 006_dashboard_roles.sql');
        return;
      }
      console.error('[dashboardAuth] mark authenticated failed:', error.message);
    }
  } catch (e: unknown) {
    console.error(
      '[dashboardAuth] mark authenticated exception:',
      e instanceof Error ? e.message : e,
    );
  }
}

/** Set authenticated = false on logout. */
export async function markUserLoggedOut(email: string): Promise<void> {
  if (!supabaseAdmin) {
    console.warn('[dashboardAuth] supabaseAdmin not configured — skip logout record');
    return;
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized) return;

  const now = new Date().toISOString();

  try {
    const { error } = await supabaseAdmin
      .from('dashboard_auth')
      .update({
        authenticated: false,
        last_logout_at: now,
        updated_at: now,
      })
      .eq('email', normalized);

    if (error) {
      console.error('[dashboardAuth] mark logged out failed:', error.message);
    }
  } catch (e: unknown) {
    console.error(
      '[dashboardAuth] mark logged out exception:',
      e instanceof Error ? e.message : e,
    );
  }
}

/** Explicitly set a user's role (for future admin UI). */
export async function setUserRole(
  email: string,
  role: DashboardRole,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabaseAdmin) return { ok: false, error: 'Supabase not configured' };
  const normalized = email.trim().toLowerCase();
  if (!normalized.endsWith('@likewize.com')) {
    return { ok: false, error: 'Email must be @likewize.com' };
  }
  if (!isDashboardRole(role)) return { ok: false, error: 'Invalid role' };

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from('dashboard_auth').upsert(
    {
      email: normalized,
      role,
      updated_at: now,
    },
    { onConflict: 'email' },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
