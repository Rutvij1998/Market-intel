"use client";

import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Check,
  Loader2,
  MessageSquareReply,
  RefreshCw,
  Sparkles,
  Wand2,
  Send,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClassifiedMention } from "@/lib/classify";
import { toast } from "sonner";

type Props = {
  mention: ClassifiedMention;
};

type Busy = null | "generate" | "rewrite" | "submit";

function newNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRedditSource(mention: ClassifiedMention): boolean {
  const s = (mention.source || "").toLowerCase();
  const u = (mention.url || "").toLowerCase();
  return s.includes("reddit") || u.includes("reddit.com") || u.includes("redd.it");
}

export function DraftReply({ mention }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [reply, setReply] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [submittedUrl, setSubmittedUrl] = useState<string | null>(null);
  const variationRef = useRef(0);
  const lastAiReplyRef = useRef("");

  useEffect(() => {
    setOpen(false);
    setBusy(null);
    setReply("");
    setCopied(false);
    setError(null);
    setHint(null);
    setSubmittedUrl(null);
    variationRef.current = 0;
    lastAiReplyRef.current = "";
  }, [mention.id]);

  function threadPayload() {
    return {
      text: mention.full_thread || mention.text || "",
      title: mention.title || "",
      source: mention.source,
      client: mention.client,
      subreddit: mention.subreddit,
      author: mention.author || null,
      sentiment: mention.sentiment,
      pillar: mention.pillar,
      key_issue: mention.key_issue,
      company: mention.company,
      business_line: mention.business_line,
      url: mention.url,
    };
  }

  async function generate(opts?: { regenerate?: boolean }) {
    const regenerate = !!opts?.regenerate;
    if (regenerate) {
      variationRef.current += 1;
    } else {
      variationRef.current = 0;
      lastAiReplyRef.current = "";
    }

    const previousSnapshot = regenerate ? lastAiReplyRef.current || reply : "";

    setBusy("generate");
    setError(null);
    setSubmittedUrl(null);
    try {
      const res = await fetch("/api/reply/draft", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...threadPayload(),
          mode: "generate",
          variation: variationRef.current,
          previousReply: previousSnapshot || undefined,
          draftText: regenerate ? reply : undefined,
          nonce: newNonce(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Draft failed (${res.status})`);
      }
      let next = String(json.reply || "");

      if (regenerate && previousSnapshot && next.trim() === previousSnapshot.trim()) {
        const retry = await fetch("/api/reply/draft", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...threadPayload(),
            mode: "generate",
            variation: variationRef.current + 10,
            previousReply: previousSnapshot,
            nonce: newNonce(),
          }),
        });
        const retryJson = await retry.json().catch(() => ({}));
        if (retry.ok && retryJson.success && retryJson.reply) {
          next = String(retryJson.reply);
          if (retryJson.warning) json.warning = retryJson.warning;
        }
      }

      setReply(next);
      lastAiReplyRef.current = next;
      setOpen(true);
      setHint(json.warning ? String(json.warning) : null);
      if (json.warning) {
        toast.message("Draft ready (offline template)", {
          description: "Grok key/model issue — each regenerate still rotates a different template.",
        });
      } else {
        toast.success(regenerate ? "New version ready" : "Reply ready — edit if needed, then submit");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to draft reply";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  async function rewriteWithAi() {
    const draft = reply.trim();
    if (!draft) {
      toast.error("Write or paste a reply in the box first");
      return;
    }

    setBusy("rewrite");
    setError(null);
    try {
      const res = await fetch("/api/reply/draft", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...threadPayload(),
          mode: "rewrite",
          draftText: draft,
          nonce: newNonce(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Rewrite failed (${res.status})`);
      }
      const next = String(json.reply || "");
      setReply(next);
      lastAiReplyRef.current = next;
      setOpen(true);
      setHint(json.warning ? String(json.warning) : null);
      setSubmittedUrl(null);
      toast.success("Rewrote your draft");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to rewrite";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  async function copyReply() {
    if (!reply.trim()) return;
    try {
      await navigator.clipboard.writeText(reply);
      setCopied(true);
      toast.success("Copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — select and copy manually");
    }
  }

  async function submitReply() {
    const text = reply.trim();
    if (!text) {
      toast.error("Nothing to submit — generate or write a reply first");
      return;
    }

    const reddit = isRedditSource(mention);
    const confirmMsg = reddit
      ? `Post this reply publicly on the original Reddit thread?\n\nIt will be submitted as your configured Reddit account (REDDIT_USERNAME).\n\nThis cannot be undone from here.`
      : `This source does not support auto-post from Market Vantage.\n\nWe’ll copy your reply and open the original page so you can paste it there.\n\nContinue?`;

    if (!window.confirm(confirmMsg)) return;

    setBusy("submit");
    setError(null);
    try {
      const res = await fetch("/api/reply/submit", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          url: mention.url || "",
          id: mention.id,
          source: mention.source,
          confirm: true,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.success) {
        // Fallback: open original if provided
        if (json.openUrl) {
          try {
            await navigator.clipboard.writeText(text);
          } catch {
            /* ignore */
          }
          window.open(String(json.openUrl), "_blank", "noopener,noreferrer");
        }
        throw new Error(json.error || `Submit failed (${res.status})`);
      }

      if (json.method === "reddit" && json.permalink) {
        setSubmittedUrl(String(json.permalink));
        toast.success(json.message || "Posted to Reddit", {
          description: "Click “View on Reddit” to see your comment.",
          action: {
            label: "Open",
            onClick: () => window.open(String(json.permalink), "_blank", "noopener,noreferrer"),
          },
        });
        return;
      }

      // Non-Reddit: copy + open original thread
      if (json.method === "open" && json.openUrl) {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          /* ignore */
        }
        window.open(String(json.openUrl), "_blank", "noopener,noreferrer");
        setSubmittedUrl(String(json.openUrl));
        toast.success("Opened original thread", {
          description: "Reply copied — paste it into the thread.",
        });
        return;
      }

      toast.success(json.message || "Submitted");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to submit reply";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  const loading = busy !== null;
  const reddit = isRedditSource(mention);

  return (
    <div className="mt-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading}
          title="Draft a human reply with AI"
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition
            border border-[var(--lw-primary)]/25
            bg-gradient-to-r from-[#F3EEFF] via-[#FFF0FF] to-[#FFE8F8]
            text-[var(--primary)]
            shadow-sm hover:shadow-md hover:border-[var(--lw-primary)]/40
            hover:from-[#EDE4FF] hover:to-[#FFD6F5]
            disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:shadow-sm"
        >
          {busy === "generate" && !open ? (
            <Loader2 className="h-4 w-4 animate-spin text-[var(--primary)]" />
          ) : (
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/80 border border-[var(--lw-primary)]/15">
              <Sparkles className="h-3.5 w-3.5 text-[#C026D3]" />
            </span>
          )}
          <span>{busy === "generate" && !open ? "Writing reply…" : "Reply with AI"}</span>
          {!(busy === "generate" && !open) && (
            <MessageSquareReply className="h-3.5 w-3.5 opacity-70" />
          )}
        </button>

        {open && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs rounded-full border-[var(--border)]"
              onClick={() => void generate({ regenerate: true })}
              disabled={loading}
              title="Write a clearly different version"
            >
              {busy === "generate" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Regenerate
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs rounded-full border-[var(--border)]"
              onClick={() => void copyReply()}
              disabled={!reply.trim() || loading}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {hint && !error && (
        <div className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {hint}
        </div>
      )}

      {open && (
        <div className="space-y-2">
          <div className="relative">
            <textarea
              value={reply}
              onChange={(e) => {
                setReply(e.target.value);
                setSubmittedUrl(null);
              }}
              rows={9}
              className="w-full rounded-xl border border-[var(--border)] bg-[#FCFBFF] px-3 py-2.5 pb-12 text-sm text-[var(--foreground)] leading-relaxed resize-y min-h-[140px] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 shadow-sm"
              placeholder="AI reply will appear here — edit freely, then submit to the original thread…"
              spellCheck
              disabled={loading}
            />
            <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void rewriteWithAi()}
                disabled={loading || !reply.trim()}
                title="Rewrite the whole text in this box with AI"
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium
                  border border-[var(--lw-primary)]/20 bg-white/95 text-[var(--primary)]
                  shadow-sm hover:bg-[#F8F4FF] hover:border-[var(--lw-primary)]/35
                  disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {busy === "rewrite" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Wand2 className="h-3 w-3 text-[#C026D3]" />
                )}
                {busy === "rewrite" ? "Editing…" : "Edit with AI"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void submitReply()}
              disabled={loading || !reply.trim() || !!submittedUrl}
              title={
                reddit
                  ? "Post this reply on the original Reddit thread"
                  : "Open the original thread and paste your reply"
              }
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition
                bg-[var(--primary)] text-white shadow-md
                hover:bg-[var(--lw-primary-hover)] hover:shadow-lg
                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-md"
            >
              {busy === "submit" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : submittedUrl ? (
                <Check className="h-4 w-4" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {busy === "submit"
                ? reddit
                  ? "Posting…"
                  : "Opening…"
                : submittedUrl
                  ? reddit
                    ? "Posted"
                    : "Opened"
                  : reddit
                    ? "Submit reply"
                    : "Submit (open thread)"}
            </button>

            {submittedUrl && (
              <a
                href={submittedUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--primary)] hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {reddit ? "View on Reddit" : "Open original"}
              </a>
            )}

            {!submittedUrl && mention.url && (
              <a
                href={mention.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Preview original thread
              </a>
            )}
          </div>

          <p className="text-[10px] text-[var(--muted-foreground)] px-0.5">
            {reddit ? (
              <>
                <span className="font-medium text-[var(--foreground)]">Submit reply</span> posts to the original
                Reddit thread as your configured Reddit account. Confirm before sending.
              </>
            ) : (
              <>
                Auto-post is only for Reddit.{" "}
                <span className="font-medium text-[var(--foreground)]">Submit</span> copies the reply and opens
                the original page so you can paste it.
              </>
            )}{" "}
            <span className="font-medium text-[var(--foreground)]">Edit with AI</span> rewrites the box first if
            you want.
          </p>
        </div>
      )}
    </div>
  );
}
