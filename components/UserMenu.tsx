"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useState } from "react";

/** Sign out of the shared Likewize session. */
export function UserMenu() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

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

  return (
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
  );
}
