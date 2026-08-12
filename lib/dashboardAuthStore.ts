/**
 * Persist dashboard login email + authentication status in Supabase.
 * Failures are logged but never block sign-in / sign-out.
 */

import { supabaseAdmin } from '@/lib/supabase';

export interface DashboardAuthRow {
  id: string;
  email: string;
  authenticated: boolean;
  last_login_at?: string | null;
  last_logout_at?: string | null;
  created_at?: string;
  updated_at?: string;
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
    const { error } = await supabaseAdmin.from('dashboard_auth').upsert(
      {
        email: normalized,
        authenticated: true,
        last_login_at: now,
        updated_at: now,
      },
      { onConflict: 'email' },
    );

    if (error) {
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
