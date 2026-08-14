import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_TABLES } from '@/lib/adminTables';
import { requireAdmin } from '@/lib/requireAdmin';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/data
 * List configured tables + approximate row counts (admin only).
 */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  const db = supabaseAdmin;
  if (!db) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const tables = await Promise.all(
    ADMIN_TABLES.map(async (t) => {
      let count: number | null = null;
      try {
        const { count: c, error } = await db
          .from(t.name)
          .select('*', { count: 'exact', head: true });
        if (!error) count = c ?? 0;
        else count = null;
      } catch {
        count = null;
      }
      return {
        name: t.name,
        label: t.label,
        description: t.description,
        primaryKey: t.primaryKey,
        canInsert: t.canInsert,
        canUpdate: t.canUpdate,
        canDelete: t.canDelete,
        count,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.type,
          list: c.list !== false,
          editable: c.editable !== false,
          required: !!c.required,
          description: c.description || null,
        })),
      };
    }),
  );

  return NextResponse.json({
    ok: true,
    email: gate.perms.email,
    tables,
  });
}
