import { NextResponse, type NextRequest } from 'next/server';
import { getRequestPermissions } from '@/lib/roles';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me
 * Current session email + role + permissions (for UI gating).
 */
export async function GET(request: NextRequest) {
  const perms = await getRequestPermissions(request);
  if (!perms) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    email: perms.email,
    role: perms.role,
    permissions: {
      reply: perms.canReply,
      admin: perms.canAdmin,
    },
  });
}
