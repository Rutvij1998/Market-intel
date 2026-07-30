"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClassifiedMention } from "@/lib/classify";
import type { HighlightReason } from "@/lib/highlightReasons";
import { getMentionClient, formatBusinessLine, type BusinessLine } from "@/lib/utils";

const VIEWER_KEY_STORAGE = "mv_feedback_viewer_key_v1";
const LOCAL_FEEDBACK_STORAGE = "mv_thread_feedback_done_v1";

type Phase = "loading" | "ask" | "comment" | "done" | "setup" | "error";

interface StoredLocalFeedback {
  useful: boolean;
  rating?: number;
  comment?: string;
  at: string;
}

const SETUP_SQL = `-- Run in Supabase → SQL Editor → Run
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.thread_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mention_id TEXT,
  reddit_id TEXT,
  thread_url TEXT NOT NULL,
  source TEXT,
  title TEXT,
  company TEXT,
  client TEXT,
  pillar TEXT,
  business_line TEXT,
  sentiment TEXT,
  useful BOOLEAN NOT NULL,
  rating SMALLINT CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  comment TEXT,
  viewer_key TEXT NOT NULL,
  active_filters JSONB,
  why_reasons JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_feedback_viewer_url
  ON public.thread_feedback (viewer_key, thread_url);

ALTER TABLE public.thread_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable insert for anon feedback" ON public.thread_feedback;
CREATE POLICY "Enable insert for anon feedback" ON public.thread_feedback
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Enable read access for feedback" ON public.thread_feedback;
CREATE POLICY "Enable read access for feedback" ON public.thread_feedback
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.thread_feedback ADD COLUMN IF NOT EXISTS rating SMALLINT;
NOTIFY pgrst, 'reload schema';`;

function getOrCreateViewerKey(): string {
  if (typeof window === "undefined") return "";
  try {
    let key = localStorage.getItem(VIEWER_KEY_STORAGE);
    if (!key) {
      key =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `v_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(VIEWER_KEY_STORAGE, key);
    }
    return key;
  } catch {
    return `v_session_${Date.now()}`;
  }
}

function threadKey(url: string, mentionId?: string): string {
  const u = (url || "").trim();
  if (u) return u;
  return `id:${mentionId || "unknown"}`;
}

function readLocalMap(): Record<string, StoredLocalFeedback> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LOCAL_FEEDBACK_STORAGE);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalFeedback(key: string, value: StoredLocalFeedback) {
  try {
    const map = readLocalMap();
    map[key] = value;
    localStorage.setItem(LOCAL_FEEDBACK_STORAGE, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function StarRow({
  value,
  onChange,
  disabled,
  size = "md",
}: {
  value: number;
  onChange?: (n: number) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const [hover, setHover] = useState(0);
  const display = hover || value;
  const iconClass = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <div
      className="flex items-center gap-0.5 shrink-0"
      onMouseLeave={() => !disabled && setHover(0)}
      role="radiogroup"
      aria-label="Star rating"
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= display;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            disabled={disabled}
            className={`p-0.5 rounded transition-transform ${
              disabled ? "cursor-default" : "cursor-pointer hover:scale-110"
            }`}
            onMouseEnter={() => !disabled && setHover(n)}
            onFocus={() => !disabled && setHover(n)}
            onClick={() => onChange?.(n)}
          >
            <Star
              className={`${iconClass} ${
                filled
                  ? "fill-amber-400 text-amber-400"
                  : "fill-transparent text-[var(--border-strong)]"
              }`}
              strokeWidth={1.75}
            />
          </button>
        );
      })}
    </div>
  );
}

export interface ThreadFeedbackProps {
  mention: ClassifiedMention;
  whyReasons?: HighlightReason[];
  activeClient?: string;
  activeBusinessLine?: "All" | BusinessLine;
  drillPillar?: string | null;
  activeTab?: "overview" | "competitor";
  /** Optional chips / details under the “Why this thread is here” header */
  whyContent?: React.ReactNode;
}

/**
 * Stars sit beside “Why this thread is here”.
 * Feedback box only opens after a star rating is chosen.
 */
export function ThreadFeedback({
  mention,
  whyReasons = [],
  activeClient = "All",
  activeBusinessLine = "All",
  drillPillar = null,
  activeTab = "overview",
  whyContent,
}: ThreadFeedbackProps) {
  const url = (mention.url || "").trim();
  const key = useMemo(() => threadKey(url, mention.id), [url, mention.id]);

  const [phase, setPhase] = useState<Phase>("loading");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [savedComment, setSavedComment] = useState<string | null>(null);
  const [savedRating, setSavedRating] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [viewerKey, setViewerKey] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const vk = getOrCreateViewerKey();
    setViewerKey(vk);

    const local = readLocalMap()[key];
    if (local) {
      setSavedRating(local.rating ?? (local.useful ? 5 : 2));
      setSavedComment(local.comment || null);
      setPhase("done");
      return;
    }

    if (!url || !vk) {
      setPhase("ask");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ viewer_key: vk, thread_url: url });
        const res = await fetch(`/api/feedback?${qs.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (json?.tableMissing) {
          setPhase("setup");
          return;
        }
        if (json?.submitted && json.feedback) {
          const r =
            typeof json.feedback.rating === "number"
              ? json.feedback.rating
              : json.feedback.useful
                ? 5
                : 2;
          const c = json.feedback.comment || "";
          writeLocalFeedback(key, {
            useful: !!json.feedback.useful,
            rating: r,
            comment: c,
            at: json.feedback.created_at || new Date().toISOString(),
          });
          setSavedRating(r);
          setSavedComment(c || null);
          setPhase("done");
          return;
        }
        setPhase("ask");
      } catch {
        if (!cancelled) setPhase("ask");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key, url]);

  const onPickStars = useCallback((n: number) => {
    setRating(n);
    setError(null);
    setPhase("comment");
  }, []);

  const onSubmit = useCallback(async () => {
    if (rating < 1 || rating > 5) {
      setError("Pick a star rating from 1 to 5.");
      return;
    }
    const trimmed = comment.trim();
    if (trimmed.length < 2) {
      setError(
        rating >= 4
          ? "Add a short comment about what was useful."
          : "Tell us briefly what we should improve.",
      );
      return;
    }
    if (!viewerKey) {
      setError("Could not identify this browser session. Refresh and try again.");
      return;
    }
    if (!url) {
      setError("This thread has no URL, so feedback can’t be stored yet.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const useful = rating >= 4;
      const payload = {
        mention_id: mention.id || null,
        reddit_id: (mention as any).reddit_id || mention.id || null,
        thread_url: url,
        source: mention.source || null,
        title: mention.title || (mention.text || "").slice(0, 160) || null,
        company: mention.company || null,
        client: getMentionClient(mention as any),
        pillar: mention.pillar || null,
        business_line: mention.business_line || null,
        sentiment: mention.sentiment || null,
        useful,
        rating,
        comment: trimmed,
        viewer_key: viewerKey,
        active_filters: {
          client: activeClient,
          business_line: activeBusinessLine,
          pillar: drillPillar,
          tab: activeTab,
        },
        why_reasons: whyReasons.map((r) => ({
          id: r.id,
          kind: r.kind,
          label: r.label,
          terms: r.terms,
        })),
      };

      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        const msg = json?.error || `Save failed (${res.status})`;
        if (/schema cache|does not exist|thread_feedback|Create the table/i.test(msg)) {
          setPhase("setup");
          setError(msg);
          return;
        }
        throw new Error(msg);
      }

      writeLocalFeedback(key, {
        useful,
        rating,
        comment: trimmed,
        at: new Date().toISOString(),
      });
      setSavedComment(trimmed);
      setSavedRating(rating);
      setPhase("done");
    } catch (e: any) {
      setError(e?.message || "Failed to save feedback.");
      setPhase("error");
    } finally {
      setSubmitting(false);
    }
  }, [
    rating,
    comment,
    viewerKey,
    url,
    mention,
    activeClient,
    activeBusinessLine,
    drillPillar,
    activeTab,
    whyReasons,
    key,
  ]);

  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(SETUP_SQL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy — select the SQL manually.");
    }
  };

  const starsInHeader =
    phase === "loading" ? (
      <span className="text-[10px] text-[var(--muted-foreground)] shrink-0">…</span>
    ) : phase === "done" && savedRating != null ? (
      <StarRow value={savedRating} disabled size="sm" />
    ) : phase === "setup" ? null : (
      <div className="flex items-center gap-2 shrink-0">
        <StarRow value={rating} onChange={onPickStars} size="sm" />
        {rating > 0 && (
          <span className="text-[10px] font-medium tabular-nums text-[var(--muted-foreground)] hidden sm:inline">
            {rating}/5
          </span>
        )}
      </div>
    );

  return (
    <div className="mv-why-box mb-4">
      {/* Title + stars on one row */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="mv-why-title !mb-0">Why this thread is here</div>
        {starsInHeader}
      </div>

      {whyContent}

      {/* Feedback box only after stars are selected */}
      {(phase === "comment" || phase === "error") && rating > 0 && (
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-white/80 p-3 space-y-2">
          <label className="block text-xs font-medium text-[var(--foreground)]">
            {rating >= 4
              ? "What was useful? (short comment)"
              : "What should we improve? (brief feedback)"}
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={4000}
            autoFocus
            placeholder={
              rating >= 4
                ? "e.g. Highlights made the client + Call Center match clear…"
                : "e.g. Wrong brand match / not about device protection…"
            }
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--lw-primary-ring)] focus:border-[var(--lw-primary)] resize-y min-h-[72px]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="button-primary text-white"
              disabled={submitting}
              onClick={onSubmit}
            >
              {submitting ? "Saving…" : "Submit rating"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={submitting}
              onClick={() => {
                setPhase("ask");
                setRating(0);
                setComment("");
                setError(null);
              }}
            >
              Cancel
            </Button>
            {activeBusinessLine !== "All" && (
              <span className="text-[10px] text-[var(--muted-foreground)] ml-auto">
                Context: {formatBusinessLine(activeBusinessLine)}
                {drillPillar ? ` · ${drillPillar}` : ""}
              </span>
            )}
          </div>
          {error && (
            <div className="text-xs text-[var(--danger,#e11d48)] leading-snug">{error}</div>
          )}
        </div>
      )}

      {phase === "done" && savedRating != null && savedComment && (
        <div className="mt-2 text-xs text-[var(--muted-foreground)]">
          Rated {savedRating}/5
          {savedComment ? (
            <span className="block mt-1 text-[var(--foreground)] mv-inset p-2 whitespace-pre-wrap">
              {savedComment}
            </span>
          ) : null}
        </div>
      )}

      {phase === "setup" && (
        <div className="mt-3 rounded-xl border border-[rgba(225,29,72,0.25)] bg-white p-3">
          <div className="text-sm font-semibold text-[var(--foreground)]">
            One-time Supabase setup needed
          </div>
          <div className="text-xs text-[var(--muted-foreground)] mt-1 leading-relaxed">
            The <code className="text-[var(--foreground)]">thread_feedback</code> table is missing.
            Create it once in Supabase SQL Editor.
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" className="button-primary text-white" onClick={copySql}>
              {copied ? "Copied!" : "Copy SQL"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setError(null);
                setPhase("ask");
              }}
            >
              I’ve run it — try again
            </Button>
          </div>
          <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-[var(--muted)] border border-[var(--border)] p-2 text-[10px] leading-snug text-[var(--muted-foreground)] whitespace-pre-wrap">
            {SETUP_SQL}
          </pre>
          {error && <div className="mt-2 text-xs text-[var(--danger,#e11d48)]">{error}</div>}
        </div>
      )}
    </div>
  );
}
