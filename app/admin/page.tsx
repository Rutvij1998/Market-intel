'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Database,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  Star,
  Trash2,
  X,
  LayoutDashboard,
  Pencil,
} from 'lucide-react';
import { UserMenu } from '@/components/UserMenu';

type ColMeta = {
  name: string;
  type: string;
  list?: boolean;
  editable?: boolean;
  required?: boolean;
  description?: string | null;
};

type TableMeta = {
  name: string;
  label: string;
  description: string;
  primaryKey: string;
  canInsert: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  count: number | null;
  columns: ColMeta[];
};

type Row = Record<string, unknown>;

function cellPreview(value: unknown, max = 80): string {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    try {
      const s = JSON.stringify(value);
      return s.length > max ? s.slice(0, max) + '…' : s;
    } catch {
      return '[object]';
    }
  }
  const s = String(value);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function fieldToInputValue(value: unknown, type: string): string {
  if (value == null) return '';
  if (type === 'json' || type === 'array') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export default function AdminPage() {
  const router = useRouter();
  const [authChecking, setAuthChecking] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  const [tables, setTables] = useState<TableMeta[]>([]);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [activeTable, setActiveTable] = useState<string | null>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [columns, setColumns] = useState<ColMeta[]>([]);
  const [primaryKey, setPrimaryKey] = useState('id');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(40);
  const [q, setQ] = useState('');
  const [qDraft, setQDraft] = useState('');
  const [loadingRows, setLoadingRows] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [canInsert, setCanInsert] = useState(false);
  const [canUpdate, setCanUpdate] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'edit' | 'create'>('edit');
  const [editorRow, setEditorRow] = useState<Row | null>(null);
  const [editorDraft, setEditorDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Gate: admin role only
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !json?.ok) {
          router.replace('/sign-in?redirect=/admin');
          return;
        }
        setEmail(json.email || null);
        if (!json.permissions?.admin) {
          setForbidden(true);
        }
      } catch {
        if (!cancelled) router.replace('/sign-in?redirect=/admin');
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const loadTables = useCallback(async () => {
    setTablesError(null);
    try {
      const res = await fetch('/api/admin/data', { credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok || !json.ok) {
        setTablesError(json.error || `Failed (${res.status})`);
        return;
      }
      setTables(json.tables || []);
      if (!activeTable && json.tables?.length) {
        setActiveTable(json.tables[0].name);
      }
    } catch (e: unknown) {
      setTablesError(e instanceof Error ? e.message : 'Failed to load tables');
    }
  }, [activeTable]);

  useEffect(() => {
    if (authChecking || forbidden) return;
    void loadTables();
  }, [authChecking, forbidden, loadTables]);

  const loadRows = useCallback(async () => {
    if (!activeTable) return;
    setLoadingRows(true);
    setRowsError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (q) params.set('q', q);
      const res = await fetch(`/api/admin/data/${encodeURIComponent(activeTable)}?${params}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setRowsError(json.error || json.hint || `Failed (${res.status})`);
        setRows([]);
        return;
      }
      setRows(json.rows || []);
      setColumns(json.columns || []);
      setPrimaryKey(json.primaryKey || 'id');
      setTotal(json.total ?? 0);
      setCanInsert(!!json.canInsert);
      setCanUpdate(!!json.canUpdate);
      setCanDelete(!!json.canDelete);
      if (json.pageSize) setPageSize(json.pageSize);
    } catch (e: unknown) {
      setRowsError(e instanceof Error ? e.message : 'Failed to load rows');
    } finally {
      setLoadingRows(false);
    }
  }, [activeTable, page, pageSize, q]);

  useEffect(() => {
    if (authChecking || forbidden || !activeTable) return;
    void loadRows();
  }, [authChecking, forbidden, activeTable, page, q, loadRows]);

  const activeMeta = useMemo(
    () => tables.find((t) => t.name === activeTable) || null,
    [tables, activeTable],
  );

  const listColumns = useMemo(
    () => columns.filter((c) => c.list !== false),
    [columns],
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function openCreate() {
    const draft: Record<string, string> = {};
    for (const c of columns) {
      if (c.editable === false) continue;
      if (c.type === 'boolean') draft[c.name] = 'false';
      else if (c.type === 'array') draft[c.name] = '[]';
      else if (c.type === 'json') draft[c.name] = '{}';
      else draft[c.name] = '';
    }
    if (activeTable === 'dashboard_auth') {
      draft.role = draft.role || 'viewer';
      draft.authenticated = 'false';
    }
    setEditorMode('create');
    setEditorRow(null);
    setEditorDraft(draft);
    setSaveError(null);
    setEditorOpen(true);
  }

  function openEdit(row: Row) {
    const draft: Record<string, string> = {};
    for (const c of columns) {
      draft[c.name] = fieldToInputValue(row[c.name], c.type);
    }
    setEditorMode('edit');
    setEditorRow(row);
    setEditorDraft(draft);
    setSaveError(null);
    setEditorOpen(true);
  }

  async function saveEditor() {
    if (!activeTable) return;
    setSaving(true);
    setSaveError(null);
    try {
      const row: Record<string, unknown> = {};
      for (const c of columns) {
        if (editorMode === 'edit' && c.editable === false) continue;
        if (editorMode === 'create' && c.editable === false) continue;
        if (!(c.name in editorDraft)) continue;
        const raw = editorDraft[c.name];
        if (c.type === 'boolean') {
          row[c.name] = raw === 'true' || raw === '1';
        } else if (c.type === 'number') {
          row[c.name] = raw === '' ? null : Number(raw);
        } else if (c.type === 'json' || c.type === 'array') {
          if (raw.trim() === '') {
            row[c.name] = c.type === 'array' ? [] : null;
          } else {
            row[c.name] = JSON.parse(raw);
          }
        } else {
          row[c.name] = raw === '' ? null : raw;
        }
      }

      if (editorMode === 'create') {
        const res = await fetch(`/api/admin/data/${encodeURIComponent(activeTable)}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ row }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) throw new Error(json.error || 'Insert failed');
      } else {
        const id = editorRow?.[primaryKey];
        const res = await fetch(`/api/admin/data/${encodeURIComponent(activeTable)}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, row }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) throw new Error(json.error || 'Update failed');
      }

      setEditorOpen(false);
      await loadRows();
      await loadTables();
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function deleteRow(row: Row) {
    if (!activeTable || !canDelete) return;
    const id = row[primaryKey];
    if (id == null) return;
    const label = String(row.email || row.title || row.job_name || id);
    if (!window.confirm(`Delete this row?\n\n${label}\n\nThis writes to Supabase immediately.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/data/${encodeURIComponent(activeTable)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || 'Delete failed');
      await loadRows();
      await loadTables();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)] text-[var(--muted-foreground)] gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        Checking access…
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--background)] px-4">
        <Shield className="h-10 w-10 text-[var(--primary)] mb-4" />
        <h1 className="text-xl font-semibold">You don&apos;t have access to admin</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)] max-w-md text-center leading-relaxed">
          Contact us if you need admin access.
          {email ? (
            <>
              {' '}
              You&apos;re signed in as <span className="font-medium text-[var(--foreground)]">{email}</span>.
            </>
          ) : null}
        </p>
        <Link
          href="/dashboard"
          className="mt-6 text-sm font-medium text-[var(--primary)] hover:underline"
        >
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)] text-[var(--foreground)]">
      {/* Top bar — admin only, no dashboard widgets */}
      <header className="border-b border-[var(--border)] bg-white/95 backdrop-blur sticky top-0 z-40">
        <div className="px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="h-8 w-8 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: '#3200BE' }}
            >
              <Star className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold tracking-tight text-sm leading-tight">Admin console</div>
              <div className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider truncate">
                Supabase data · Market Vantage
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[var(--muted)]"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Dashboard
            </Link>
            <div className="rounded-full overflow-hidden [&_button]:!border-[var(--border)] [&_button]:!bg-[var(--muted)] [&_button]:!text-[var(--foreground)] [&_span]:!border-[var(--border)] [&_span]:!bg-[var(--muted)] [&_span]:!text-[var(--foreground)]">
              <UserMenu />
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Table nav */}
        <aside className="w-64 shrink-0 border-r border-[var(--border)] bg-white overflow-y-auto hidden md:block">
          <div className="p-3 border-b border-[var(--border)]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5" />
              Tables
            </div>
          </div>
          {tablesError && (
            <div className="m-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
              {tablesError}
            </div>
          )}
          <nav className="p-2 space-y-0.5">
            {tables.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => {
                  setActiveTable(t.name);
                  setPage(1);
                  setQ('');
                  setQDraft('');
                }}
                className={`w-full text-left rounded-lg px-3 py-2.5 transition ${
                  activeTable === t.name
                    ? 'bg-[var(--lw-primary-soft)] text-[var(--primary)]'
                    : 'hover:bg-[var(--muted)]'
                }`}
              >
                <div className="text-sm font-medium truncate">{t.label}</div>
                <div className="text-[10px] text-[var(--muted-foreground)] flex justify-between gap-2 mt-0.5">
                  <span className="font-mono truncate">{t.name}</span>
                  <span className="shrink-0">{t.count == null ? '—' : t.count}</span>
                </div>
              </button>
            ))}
          </nav>
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* Mobile table picker */}
          <div className="md:hidden border-b border-[var(--border)] bg-white px-3 py-2">
            <select
              className="w-full h-10 rounded-lg border border-[var(--border)] px-3 text-sm"
              value={activeTable || ''}
              onChange={(e) => {
                setActiveTable(e.target.value);
                setPage(1);
              }}
            >
              {tables.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.label} ({t.count ?? '?'})
                </option>
              ))}
            </select>
          </div>

          <div className="border-b border-[var(--border)] bg-white px-4 sm:px-6 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">
                  {activeMeta?.label || 'Select a table'}
                </h1>
                <p className="mt-1 text-sm text-[var(--muted-foreground)] max-w-2xl">
                  {activeMeta?.description || 'Changes save directly to Supabase.'}
                </p>
                {activeMeta && (
                  <p className="mt-1 text-[11px] font-mono text-[var(--muted-foreground)]">
                    public.{activeMeta.name} · {total} row{total === 1 ? '' : 's'}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <form
                  className="relative"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setPage(1);
                    setQ(qDraft.trim());
                  }}
                >
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                  <input
                    value={qDraft}
                    onChange={(e) => setQDraft(e.target.value)}
                    placeholder="Search…"
                    className="h-9 w-44 sm:w-56 rounded-full border border-[var(--border)] bg-white pl-8 pr-3 text-sm"
                  />
                </form>
                <button
                  type="button"
                  onClick={() => void loadRows()}
                  className="inline-flex items-center gap-1.5 h-9 rounded-full border border-[var(--border)] px-3 text-xs font-medium hover:bg-[var(--muted)]"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingRows ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                {canInsert && (
                  <button
                    type="button"
                    onClick={openCreate}
                    className="inline-flex items-center gap-1.5 h-9 rounded-full px-3 text-xs font-semibold text-white"
                    style={{ backgroundColor: '#3200BE' }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add row
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4 sm:p-6">
            {rowsError && (
              <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {rowsError}
              </div>
            )}

            <div className="rounded-xl border border-[var(--border)] bg-white shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-left">
                      {listColumns.map((c) => (
                        <th
                          key={c.name}
                          className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] whitespace-nowrap"
                        >
                          {c.name}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] w-28">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingRows && rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={listColumns.length + 1}
                          className="px-3 py-12 text-center text-[var(--muted-foreground)]"
                        >
                          <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
                          Loading…
                        </td>
                      </tr>
                    )}
                    {!loadingRows && rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={listColumns.length + 1}
                          className="px-3 py-12 text-center text-[var(--muted-foreground)]"
                        >
                          No rows found.
                        </td>
                      </tr>
                    )}
                    {rows.map((row) => (
                      <tr
                        key={String(row[primaryKey] ?? JSON.stringify(row).slice(0, 40))}
                        className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/30"
                      >
                        {listColumns.map((c) => (
                          <td
                            key={c.name}
                            className="px-3 py-2 align-top max-w-[14rem] truncate font-mono text-xs"
                            title={cellPreview(row[c.name], 500)}
                          >
                            {cellPreview(row[c.name])}
                          </td>
                        ))}
                        <td className="px-3 py-2 align-top whitespace-nowrap">
                          {canUpdate && (
                            <button
                              type="button"
                              onClick={() => openEdit(row)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline mr-2"
                            >
                              <Pencil className="h-3 w-3" />
                              Edit
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => void deleteRow(row)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 text-sm">
              <span className="text-[var(--muted-foreground)] text-xs">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-8 px-3 rounded-full border border-[var(--border)] text-xs font-medium disabled:opacity-40 hover:bg-white"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-8 px-3 rounded-full border border-[var(--border)] text-xs font-medium disabled:opacity-40 hover:bg-white"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Editor drawer */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            aria-label="Close"
            onClick={() => !saving && setEditorOpen(false)}
          />
          <div className="relative w-full max-w-lg bg-white shadow-xl border-l border-[var(--border)] flex flex-col max-h-full">
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <h2 className="font-semibold">
                  {editorMode === 'create' ? 'Add row' : 'Edit row'}
                </h2>
                <p className="text-xs text-[var(--muted-foreground)] font-mono mt-0.5">
                  {activeTable}
                </p>
              </div>
              <button
                type="button"
                onClick={() => !saving && setEditorOpen(false)}
                className="p-1.5 rounded-lg hover:bg-[var(--muted)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {columns.map((c) => {
                const locked = c.editable === false;
                if (editorMode === 'create' && locked) return null;
                return (
                  <div key={c.name}>
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
                      {c.name}
                      {c.required ? ' *' : ''}
                      {locked ? ' (read-only)' : ''}
                    </label>
                    {c.description && (
                      <p className="text-[11px] text-[var(--muted-foreground)] mb-1">{c.description}</p>
                    )}
                    {c.type === 'boolean' ? (
                      <select
                        disabled={locked || saving}
                        value={editorDraft[c.name] || 'false'}
                        onChange={(e) =>
                          setEditorDraft((d) => ({ ...d, [c.name]: e.target.value }))
                        }
                        className="w-full h-10 rounded-lg border border-[var(--border)] px-3 text-sm disabled:opacity-60"
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : c.type === 'json' || c.type === 'array' ? (
                      <textarea
                        disabled={locked || saving}
                        value={editorDraft[c.name] || ''}
                        onChange={(e) =>
                          setEditorDraft((d) => ({ ...d, [c.name]: e.target.value }))
                        }
                        rows={6}
                        className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-mono disabled:opacity-60"
                      />
                    ) : c.name === 'role' && activeTable === 'dashboard_auth' ? (
                      <select
                        disabled={locked || saving}
                        value={editorDraft[c.name] || 'viewer'}
                        onChange={(e) =>
                          setEditorDraft((d) => ({ ...d, [c.name]: e.target.value }))
                        }
                        className="w-full h-10 rounded-lg border border-[var(--border)] px-3 text-sm disabled:opacity-60"
                      >
                        <option value="viewer">viewer</option>
                        <option value="responder">responder</option>
                        <option value="admin">admin</option>
                      </select>
                    ) : (
                      <input
                        disabled={locked || saving}
                        value={editorDraft[c.name] || ''}
                        onChange={(e) =>
                          setEditorDraft((d) => ({ ...d, [c.name]: e.target.value }))
                        }
                        className="w-full h-10 rounded-lg border border-[var(--border)] px-3 text-sm disabled:opacity-60"
                      />
                    )}
                  </div>
                );
              })}
              {saveError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {saveError}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-[var(--border)] flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setEditorOpen(false)}
                className="h-10 px-4 rounded-full border border-[var(--border)] text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveEditor()}
                className="h-10 px-4 rounded-full text-sm font-semibold text-white inline-flex items-center gap-2 disabled:opacity-60"
                style={{ backgroundColor: '#3200BE' }}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save to Supabase
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
