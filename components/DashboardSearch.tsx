"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, Building2, Layers, Radio, MessageSquareText, X } from "lucide-react";
import type { ClassifiedMention } from "@/lib/classify";
import {
  formatBusinessLine,
  formatMentionSourceLabel,
  getMentionClient,
  detectBusinessLine,
  type BusinessLine,
  BUSINESS_LINE_LABELS,
} from "@/lib/utils";

export type SearchHit =
  | { kind: "client"; id: string; label: string; value: string; sub?: string }
  | { kind: "business_line"; id: string; label: string; value: BusinessLine; sub?: string }
  | { kind: "source"; id: string; label: string; value: string; sub?: string }
  | { kind: "thread"; id: string; label: string; mention: ClassifiedMention; sub?: string };

const KIND_META: Record<
  SearchHit["kind"],
  { title: string; icon: typeof Search }
> = {
  client: { title: "Clients", icon: Building2 },
  business_line: { title: "Business lines", icon: Layers },
  source: { title: "Sources", icon: Radio },
  thread: { title: "Threads", icon: MessageSquareText },
};

function sourceKey(m: ClassifiedMention): string {
  return formatMentionSourceLabel(m.source);
}

function matchesQuery(hay: string, q: string): boolean {
  if (!q) return true;
  return hay.toLowerCase().includes(q);
}

export function buildSearchHits(
  mentions: ClassifiedMention[],
  query: string,
  opts?: { includeBusinessLines?: boolean },
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];

  const includeBiz = opts?.includeBusinessLines !== false;
  const clients = new Map<string, number>();
  const lines = new Map<BusinessLine, number>();
  const sources = new Map<string, number>();
  const threads: ClassifiedMention[] = [];

  for (const m of mentions) {
    const client = getMentionClient(m as any);
    clients.set(client, (clients.get(client) || 0) + 1);

    const line = (m.business_line || detectBusinessLine(m as any)) as BusinessLine;
    lines.set(line, (lines.get(line) || 0) + 1);

    const src = sourceKey(m);
    sources.set(src, (sources.get(src) || 0) + 1);

    const hay = [
      m.title,
      m.text,
      m.url,
      m.id,
      m.subreddit,
      m.client,
      m.company,
      m.pillar,
      src,
      client,
      formatBusinessLine(line),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (matchesQuery(hay, q)) threads.push(m);
  }

  const hits: SearchHit[] = [];

  for (const [name, count] of [...clients.entries()].sort((a, b) => b[1] - a[1])) {
    if (name === "Unassigned") continue;
    if (!matchesQuery(name, q)) continue;
    hits.push({
      kind: "client",
      id: `client:${name}`,
      label: name,
      value: name,
      sub: `${count} mentions`,
    });
  }

  if (includeBiz) {
    for (const line of Object.keys(BUSINESS_LINE_LABELS) as BusinessLine[]) {
      const label = BUSINESS_LINE_LABELS[line];
      const count = lines.get(line) || 0;
      if (count === 0 && !matchesQuery(label, q) && !matchesQuery(line, q)) continue;
      if (!matchesQuery(label, q) && !matchesQuery(line, q)) continue;
      hits.push({
        kind: "business_line",
        id: `line:${line}`,
        label,
        value: line,
        sub: count ? `${count} mentions` : undefined,
      });
    }
  }

  for (const [name, count] of [...sources.entries()].sort((a, b) => b[1] - a[1])) {
    if (!matchesQuery(name, q)) continue;
    hits.push({
      kind: "source",
      id: `source:${name}`,
      label: name,
      value: name,
      sub: `${count} mentions`,
    });
  }

  threads
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 12)
    .forEach((m) => {
      const title =
        (m.title && m.title.trim()) ||
        (m.text || "").trim().slice(0, 80) ||
        "Untitled thread";
      hits.push({
        kind: "thread",
        id: `thread:${m.id}`,
        label: title,
        mention: m,
        sub: `${formatMentionSourceLabel(m.source)}${m.subreddit ? ` · r/${m.subreddit}` : ""} · ${m.sentiment}`,
      });
    });

  return hits;
}

export interface DashboardSearchProps {
  mentions: ClassifiedMention[];
  includeBusinessLines?: boolean;
  onSelectClient: (name: string) => void;
  onSelectBusinessLine: (line: BusinessLine) => void;
  onSelectSource: (source: string) => void;
  onSelectThread: (m: ClassifiedMention) => void;
}

export function DashboardSearch({
  mentions,
  includeBusinessLines = true,
  onSelectClient,
  onSelectBusinessLine,
  onSelectSource,
  onSelectThread,
}: DashboardSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(
    () => buildSearchHits(mentions, query, { includeBusinessLines }),
    [mentions, query, includeBusinessLines],
  );

  const flat = hits;
  const grouped = useMemo(() => {
    const order: SearchHit["kind"][] = ["client", "business_line", "source", "thread"];
    return order
      .map((kind) => ({ kind, items: flat.filter((h) => h.kind === kind) }))
      .filter((g) => g.items.length > 0);
  }, [flat]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function applyHit(hit: SearchHit) {
    if (hit.kind === "client") onSelectClient(hit.value);
    else if (hit.kind === "business_line") onSelectBusinessLine(hit.value);
    else if (hit.kind === "source") onSelectSource(hit.value);
    else onSelectThread(hit.mention);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter") && query.trim()) {
      setOpen(true);
      return;
    }
    if (!open || flat.length === 0) {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = flat[activeIdx];
      if (hit) applyHit(hit);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  let runningIdx = -1;

  return (
    <div ref={rootRef} className="relative order-1 lg:order-none w-full sm:w-auto sm:min-w-[200px] lg:min-w-[240px] max-w-full">
      <div className="mv-select !flex items-center gap-2 w-full max-w-[min(100%,280px)] lg:max-w-[300px] h-9 px-3">
        <Search className="h-3.5 w-3.5 text-[var(--muted-foreground)] shrink-0" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (query.trim()) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search client, line, source, thread…"
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-xs lg:text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
          aria-label="Search clients, business lines, sources, or threads"
          aria-expanded={open}
          aria-controls="dashboard-search-results"
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            onClick={() => {
              setQuery("");
              setOpen(false);
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && query.trim().length > 0 && (
        <div
          id="dashboard-search-results"
          role="listbox"
          className="absolute top-[calc(100%+6px)] left-0 z-50 w-[min(22rem,92vw)] max-h-[min(22rem,65vh)] overflow-y-auto rounded-xl border border-[var(--border)] bg-white p-1.5 shadow-lg"
        >
          {flat.length === 0 ? (
            <div className="px-3 py-4 text-xs text-[var(--muted-foreground)] text-center">
              No matches for “{query.trim()}”
            </div>
          ) : (
            grouped.map((group) => {
              const Icon = KIND_META[group.kind].icon;
              return (
                <div key={group.kind} className="mb-1 last:mb-0">
                  <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-1.5">
                    <Icon className="h-3 w-3" />
                    {KIND_META[group.kind].title}
                  </div>
                  {group.items.map((hit) => {
                    runningIdx += 1;
                    const idx = runningIdx;
                    const isActive = idx === activeIdx;
                    return (
                      <button
                        key={hit.id}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        className={`w-full text-left px-2.5 py-2 rounded-lg border-0 cursor-pointer ${
                          isActive
                            ? "bg-[var(--lw-primary-soft)] text-[var(--primary)]"
                            : "bg-transparent text-[var(--foreground)] hover:bg-[var(--muted)]"
                        }`}
                        onMouseEnter={() => setActiveIdx(idx)}
                        onClick={() => applyHit(hit)}
                      >
                        <div className="text-xs lg:text-sm font-medium line-clamp-2 leading-snug">
                          {hit.label}
                        </div>
                        {hit.sub && (
                          <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5 truncate">
                            {hit.sub}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/** Normalize UI source label to filter key used in dashboard. */
export function mentionMatchesSource(m: ClassifiedMention, source: string): boolean {
  if (!source || source === "All") return true;
  const label = formatMentionSourceLabel(m.source).toLowerCase();
  const s = (m.source || "").toLowerCase();
  const id = String(m.id || "").toLowerCase();
  const want = source.toLowerCase();
  if (label === want) return true;
  if (want === "reddit") return s.includes("reddit");
  if (want === "pissedconsumer") return s.includes("pissed");
  if (want === "bbb") return s.includes("bbb") || id.startsWith("bbb-");
  return label.includes(want) || s.includes(want);
}
