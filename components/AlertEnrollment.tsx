"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, Check, Loader2, Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BUSINESS_LINE_LABELS, type BusinessLine, BusinessLines } from "@/lib/utils";
import { toast } from "sonner";

export interface AlertEnrollmentProps {
  /** Client names available in current date window (sorted) */
  clientOptions: string[];
  open: boolean;
  onClose: () => void;
}

const SPAM_TIP =
  "Check Spam/Junk if it’s not in your inbox — mark as Not spam so future alerts arrive.";

export function AlertEnrollment({ clientOptions, open, onClose }: AlertEnrollmentProps) {
  const [email, setEmail] = useState("");
  const [allClients, setAllClients] = useState(false);
  const [clients, setClients] = useState<string[]>([]);
  const [allLines, setAllLines] = useState(false);
  const [lines, setLines] = useState<BusinessLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [emailReady, setEmailReady] = useState<boolean | null>(null);
  const [tableMissing, setTableMissing] = useState(false);

  const sortedClients = useMemo(
    () => [...clientOptions].filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [clientOptions],
  );

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const savedEmail =
      typeof window !== "undefined" ? localStorage.getItem("mv_alert_email") || "" : "";
    if (savedEmail) setEmail(savedEmail);

    (async () => {
      try {
        const qs = savedEmail
          ? `?email=${encodeURIComponent(savedEmail)}`
          : "";
        const res = await fetch(`/api/notifications/subscribe${qs}`);
        const json = await res.json().catch(() => ({}));
        setEmailReady(!!json.emailConfigured);
        setTableMissing(!!json.tableMissing);
        if (json.subscription) {
          const s = json.subscription;
          setEmail(s.email || savedEmail);
          setAllClients(!!s.all_clients);
          setClients(Array.isArray(s.clients) ? s.clients : []);
          setAllLines(!!s.all_business_lines);
          setLines(Array.isArray(s.business_lines) ? s.business_lines : []);
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  function toggleClient(name: string) {
    setAllClients(false);
    setClients((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name],
    );
  }

  function toggleLine(line: BusinessLine) {
    setAllLines(false);
    setLines((prev) =>
      prev.includes(line) ? prev.filter((l) => l !== line) : [...prev, line],
    );
  }

  async function saveSubscription(): Promise<{ ok: boolean; emailConfigured?: boolean; error?: string }> {
    const res = await fetch("/api/notifications/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        all_clients: allClients,
        clients: allClients ? [] : clients,
        all_business_lines: allLines,
        business_lines: allLines ? [] : lines,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      return { ok: false, error: json.error || "Could not save details" };
    }
    localStorage.setItem("mv_alert_email", email.trim().toLowerCase());
    setEmailReady(json.emailConfigured !== false);
    return { ok: true, emailConfigured: json.emailConfigured !== false };
  }

  /** Save filters only; email only if there are NEW matching threads. */
  async function onSaveAndCheck() {
    setSaving(true);
    try {
      const saved = await saveSubscription();
      if (!saved.ok) {
        toast.error(saved.error || "Could not save details");
        return;
      }
      if (saved.emailConfigured === false) {
        toast.warning("Details saved, but email is not configured on the server.");
        return;
      }

      // Show spam tip immediately — send can take a while (screenshots)
      toast.warning(SPAM_TIP, { duration: 14_000 });
      toast.message("Details saved — checking for new matching events…");
      const runRes = await fetch("/api/notifications/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const runJson = await runRes.json().catch(() => ({}));
      if (!runRes.ok) {
        toast.error(runJson.error || `Alert check failed (${runRes.status})`);
        return;
      }
      const sent = runJson.emailsSent ?? 0;
      if (sent > 0) {
        toast.success(SPAM_TIP, {
          description: `Email sent to ${email.trim()}. ${runJson.errors?.length ? runJson.errors.join("; ") : "Open Spam/Junk if it’s not in Inbox yet."}`,
          duration: 14_000,
        });
      } else {
        toast.success(
          "Preferences saved. No new matching threads right now — you’ll be emailed when something new appears.",
          { description: runJson.errors?.length ? runJson.errors.join("; ") : undefined },
        );
      }
      onClose();
    } catch {
      toast.error("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  /** Save filters and always email this address now (screenshot + any recent matches). */
  async function onSendNow() {
    setSaving(true);
    try {
      const saved = await saveSubscription();
      if (!saved.ok) {
        toast.error(saved.error || "Could not save details");
        return;
      }
      if (saved.emailConfigured === false) {
        toast.warning("Details saved, but email is not configured on the server.");
        return;
      }

      // Show spam tip immediately (before the long capture/send), not only after
      toast.warning(SPAM_TIP, { duration: 14_000 });
      toast.message("Sending email now — check Spam/Junk if it doesn’t land in Inbox…");
      const runRes = await fetch("/api/notifications/run?force=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          force: true,
          email: email.trim().toLowerCase(),
        }),
      });
      const runJson = await runRes.json().catch(() => ({}));
      if (!runRes.ok) {
        toast.error(runJson.error || `Send failed (${runRes.status})`);
        return;
      }
      const sent = runJson.emailsSent ?? 0;
      if (sent > 0) {
        toast.success(SPAM_TIP, {
          description: `Email sent to ${email.trim()}. ${
            runJson.errors?.length
              ? runJson.errors.join("; ")
              : "Open Spam/Junk and mark as Not spam so future alerts arrive."
          }`,
          duration: 14_000,
        });
        onClose();
      } else {
        toast.error(
          runJson.errors?.length
            ? runJson.errors.join("; ")
            : "Could not send email — check filters and server logs.",
        );
      }
    } catch {
      toast.error("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-[var(--card)] rounded-t-2xl sm:rounded-2xl shadow-2xl border border-[var(--border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)] bg-[var(--card)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-[var(--primary)]" />
              <h2 className="text-base font-semibold tracking-tight">Email alerts</h2>
            </div>
            <p className="text-xs text-[var(--muted-foreground)] mt-1 leading-relaxed">
              Choose your email and filters. Automatic alerts fire on <strong>new</strong> matching
              threads (e.g. Newegg, Rogers). You can also <strong>Send email now</strong> for an
              immediate screenshot report anytime.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Always visible at top — not buried below filters */}
        <div className="px-5 pt-3 pb-0">
          <div className="text-xs rounded-lg border border-amber-300 bg-amber-50 text-amber-950 px-3 py-2.5 leading-relaxed flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" aria-hidden />
            <div>
              <div className="font-semibold text-amber-900">Check Spam / Junk first</div>
              <p className="mt-0.5 text-amber-900/90">
                {SPAM_TIP} Alerts come from{" "}
                <span className="font-medium">market.vantage.noreply@gmail.com</span>.
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)] py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {tableMissing && (
                <div className="text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2">
                  Run <code className="font-mono">supabase/migrations/003_alert_subscriptions.sql</code> in
                  Supabase SQL Editor first.
                </div>
              )}

              {emailReady === false && (
                <div className="text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2">
                  Server email is not configured yet. Set <code className="font-mono">RESEND_API_KEY</code> +{" "}
                  <code className="font-mono">EMAIL_FROM</code> (or SMTP_*) in env so digests can send.
                </div>
              )}

              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5">
                  <Mail className="h-3.5 w-3.5" /> Your email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@likewize.com"
                  className="w-full h-10 rounded-xl border border-[var(--border)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--lw-primary-ring)] focus:border-[var(--primary)]"
                  required
                />
              </div>

              {/* Clients */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    Clients
                  </div>
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allClients}
                      onChange={(e) => {
                        setAllClients(e.target.checked);
                        if (e.target.checked) setClients([]);
                      }}
                      className="rounded border-[var(--border)]"
                    />
                    All clients
                  </label>
                </div>
                <div
                  className={`max-h-36 overflow-y-auto rounded-xl border border-[var(--border)] p-2 flex flex-wrap gap-1.5 ${
                    allClients ? "opacity-50 pointer-events-none" : ""
                  }`}
                >
                  {sortedClients.length === 0 ? (
                    <span className="text-xs text-[var(--muted-foreground)] px-1 py-2">
                      No clients in current date range.
                    </span>
                  ) : (
                    sortedClients.map((name) => {
                      const on = clients.includes(name);
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => toggleClient(name)}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium border transition ${
                            on
                              ? "bg-[var(--lw-primary-soft)] border-[var(--primary)] text-[var(--primary)]"
                              : "bg-white border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)]"
                          }`}
                        >
                          {on && <Check className="h-3 w-3" />}
                          {name}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Business lines */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    Business lines
                  </div>
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allLines}
                      onChange={(e) => {
                        setAllLines(e.target.checked);
                        if (e.target.checked) setLines([]);
                      }}
                      className="rounded border-[var(--border)]"
                    />
                    All lines
                  </label>
                </div>
                <div
                  className={`flex flex-wrap gap-1.5 ${allLines ? "opacity-50 pointer-events-none" : ""}`}
                >
                  {BusinessLines.map((line) => {
                    const on = lines.includes(line);
                    return (
                      <button
                        key={line}
                        type="button"
                        onClick={() => toggleLine(line)}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium border transition ${
                          on
                            ? "bg-[var(--lw-primary-soft)] border-[var(--primary)] text-[var(--primary)]"
                            : "bg-white border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)]"
                        }`}
                      >
                        {on && <Check className="h-3 w-3" />}
                        {BUSINESS_LINE_LABELS[line]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">
                Matching rule: a <strong>new</strong> thread must match your client selection{" "}
                <em>and</em> business line selection (if both are set). Automatic emails fire only for
                new activity. Use <strong>Send email now</strong> anytime for an immediate report with
                a live dashboard screenshot.
              </p>

              <div className="flex flex-col sm:flex-row flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  className="button-primary text-white"
                  disabled={saving || !email.trim()}
                  onClick={onSendNow}
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      Sending…
                    </>
                  ) : (
                    "Send email now"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving || !email.trim()}
                  onClick={onSaveAndCheck}
                >
                  Save &amp; check for new events
                </Button>
                <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
                  Close
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
