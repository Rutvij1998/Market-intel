import { NextResponse, type NextRequest } from 'next/server';
import { getAdminTable, type AdminColumn } from '@/lib/adminTables';
import { requireAdmin } from '@/lib/requireAdmin';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function parseCell(col: AdminColumn, raw: unknown): unknown {
  if (raw === null || raw === undefined || raw === '') {
    if (col.type === 'boolean') return false;
    return null;
  }
  switch (col.type) {
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === '1' || raw === 1) return true;
      if (raw === 'false' || raw === '0' || raw === 0) return false;
      return Boolean(raw);
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case 'json':
    case 'array': {
      if (typeof raw === 'object') return raw;
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw);
        } catch {
          throw new Error(`Invalid JSON for column ${col.name}`);
        }
      }
      return raw;
    }
    case 'timestamp':
    case 'text':
    default:
      return String(raw);
  }
}

function buildPayload(
  tableCols: AdminColumn[],
  body: Record<string, unknown>,
  mode: 'insert' | 'update',
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of tableCols) {
    if (mode === 'insert' && col.name in body === false && !col.required) continue;
    if (!(col.name in body)) continue;
    if (col.editable === false && mode === 'update') continue;
    if (col.editable === false && mode === 'insert' && col.name !== 'email' && col.name !== 'role') {
      // allow insert of required business fields even if list marks some non-editable (id etc.)
      if (col.name === 'id' || col.name.endsWith('_token')) continue;
    }
    if (col.editable === false && mode === 'insert') continue;

    out[col.name] = parseCell(col, body[col.name]);
  }
  return out;
}

type Ctx = { params: Promise<{ table: string }> };

/**
 * GET /api/admin/data/[table]?page=1&pageSize=50&q=
 * POST /api/admin/data/[table]  { row }
 * PATCH /api/admin/data/[table] { id, row }
 * DELETE /api/admin/data/[table] { id }
 */
export async function GET(request: NextRequest, context: Ctx) {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const { table: tableName } = await context.params;
  const config = getAdminTable(tableName);
  if (!config) {
    return NextResponse.json({ ok: false, error: 'Unknown table' }, { status: 404 });
  }

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get('pageSize') || String(config.pageSize || 40), 10) || 40),
  );
  const q = (url.searchParams.get('q') || '').trim();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from(config.name)
    .select('*', { count: 'exact' })
    .order(config.orderBy, { ascending: !!config.ascending })
    .range(from, to);

  // Simple search on a few text-ish columns
  if (q) {
    const textCols = config.columns
      .filter((c) => c.type === 'text' && c.list !== false)
      .map((c) => c.name)
      .slice(0, 4);
    if (textCols.length) {
      // PostgREST or filter: col.ilike.%q%
      const or = textCols.map((c) => `${c}.ilike.%${q.replace(/%/g, '')}%`).join(',');
      query = query.or(or);
    }
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        hint:
          error.message?.includes('does not exist') || error.code === '42P01'
            ? `Table "${config.name}" missing — run the matching migration in Supabase.`
            : undefined,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    table: config.name,
    label: config.label,
    primaryKey: config.primaryKey,
    page,
    pageSize,
    total: count ?? data?.length ?? 0,
    rows: data || [],
    canInsert: config.canInsert,
    canUpdate: config.canUpdate,
    canDelete: config.canDelete,
    columns: config.columns,
  });
}

export async function POST(request: NextRequest, context: Ctx) {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const { table: tableName } = await context.params;
  const config = getAdminTable(tableName);
  if (!config) {
    return NextResponse.json({ ok: false, error: 'Unknown table' }, { status: 404 });
  }
  if (!config.canInsert) {
    return NextResponse.json({ ok: false, error: 'Insert not allowed on this table' }, { status: 403 });
  }

  let body: { row?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const payload = buildPayload(config.columns, body.row || {}, 'insert');
    if (config.name === 'dashboard_auth' && payload.email) {
      payload.email = String(payload.email).trim().toLowerCase();
      if (!String(payload.email).endsWith('@likewize.com')) {
        return NextResponse.json({ ok: false, error: 'Email must be @likewize.com' }, { status: 400 });
      }
    }
    if (config.name === 'dashboard_auth' && !payload.role) payload.role = 'viewer';
    if (config.name === 'dashboard_auth') {
      payload.updated_at = new Date().toISOString();
      if (!payload.authenticated) payload.authenticated = false;
    }

    const { data, error } = await supabaseAdmin
      .from(config.name)
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, row: data });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'insert failed' },
      { status: 400 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const { table: tableName } = await context.params;
  const config = getAdminTable(tableName);
  if (!config) {
    return NextResponse.json({ ok: false, error: 'Unknown table' }, { status: 404 });
  }
  if (!config.canUpdate) {
    return NextResponse.json({ ok: false, error: 'Update not allowed on this table' }, { status: 403 });
  }

  let body: { id?: string | number; row?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.id == null || body.id === '') {
    return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
  }

  try {
    const payload = buildPayload(config.columns, body.row || {}, 'update');
    delete payload[config.primaryKey];
    if (config.name === 'dashboard_auth' && payload.email) {
      payload.email = String(payload.email).trim().toLowerCase();
    }
    if (config.name === 'dashboard_auth' || config.name === 'alert_subscriptions') {
      payload.updated_at = new Date().toISOString();
    }

    const { data, error } = await supabaseAdmin
      .from(config.name)
      .update(payload)
      .eq(config.primaryKey, body.id)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, row: data });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'update failed' },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest, context: Ctx) {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const { table: tableName } = await context.params;
  const config = getAdminTable(tableName);
  if (!config) {
    return NextResponse.json({ ok: false, error: 'Unknown table' }, { status: 404 });
  }
  if (!config.canDelete) {
    return NextResponse.json({ ok: false, error: 'Delete not allowed on this table' }, { status: 403 });
  }

  let body: { id?: string | number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (body.id == null || body.id === '') {
    return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from(config.name).delete().eq(config.primaryKey, body.id);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
