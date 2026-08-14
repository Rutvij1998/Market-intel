import { NextResponse } from 'next/server';
import { getRequestPermissions, type UserPermissions } from '@/lib/roles';

export async function requireAdmin(
  request: Request,
): Promise<{ ok: true; perms: UserPermissions } | { ok: false; response: NextResponse }> {
  const perms = await getRequestPermissions(request);
  if (!perms) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }),
    };
  }
  if (!perms.canAdmin) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: "You don't have access to admin. Contact us if you need it.",
        },
        { status: 403 },
      ),
    };
  }
  return { ok: true, perms };
}
