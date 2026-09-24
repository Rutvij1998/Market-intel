"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/** Sign out + show signed-in email / role. Product Hub account chip. */
export function UserMenu() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const accountRef = useRef<HTMLDetailsElement>(null);

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

  const initials =
    email
      ?.split("@")[0]
      ?.split(/[._-]+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "P";
  const roleLabel =
    role === "admin" ? "Admin" : role === "responder" ? "Responder" : role === "viewer" ? "Viewer" : null;

  return (
    <details className="hub-account" ref={accountRef}>
      <summary aria-label={email ? `Signed in as ${email}` : "Account"}>{initials}</summary>
      <div className="hub-account-menu">
        <span>Signed in</span>
        <strong>{email || "Likewize user"}</strong>
        {roleLabel && <span>{roleLabel}</span>}
        {role === "admin" && (
          <Link href="/admin">
            Admin console
          </Link>
        )}
        <button type="button" disabled={busy} onClick={logout}>
          <LogOut size={16} aria-hidden="true" />
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </details>
  );
}
