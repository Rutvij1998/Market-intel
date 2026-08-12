/** Likewize work-email helpers for dashboard access. */

export const DOMAIN_ERROR =
  'This dashboard is only accessible for Likewize users.';

/** Normalize + validate @likewize.com work email. */
export function normalizeLikewizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@likewize\.com$/.test(email)) return null;
  return email;
}

export function isLikewizeEmail(raw: string): boolean {
  return normalizeLikewizeEmail(raw) !== null;
}
