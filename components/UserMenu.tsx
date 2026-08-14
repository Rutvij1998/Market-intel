"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";

/** Sign out + show signed-in email / role. */
export function UserMenu() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (cancelled || !res.ok || !json?.ok) return;
        setEmail(typeof json.email === "string" ? json.email : null);
        setRole(typeof json.role === "string" ? json.role : null);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const shortEmail = email ? email.split("@")[0] : null;
  const roleLabel =
    role === "admin" ? "Admin" : role === "responder" ? "Responder" : role === "viewer" ? "Viewer" : null;

  return (
    <div className="inline-flex items-center gap-1.5">
      {(shortEmail || roleLabel) && (
        <span
          className="hidden sm:inline-flex max-w-[10rem] truncate rounded-full border border-white/20 bg-white/10 px-2 py-1 text-[10px] font-medium text-white/85"
          title={email || undefined}
        >
          {shortEmail}
          {roleLabel ? ` · ${roleLabel}` : ""}
        </span>
      )}
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-2.5 py-1.5 text-[11px] font-medium text-white/90 hover:bg-white/15 disabled:opacity-60"
        title="Sign out"
      >
        <LogOut className="h-3.5 w-3.5" />
        {busy ? "…" : "Sign out"}
      </button>
    </div>
  );
}
