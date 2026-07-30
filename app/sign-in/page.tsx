"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Star, Lock, Loader2 } from "lucide-react";

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/dashboard";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setError(json?.error || "Sign in failed.");
        return;
      }
      router.replace(json.redirect || redirectTo || "/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)] text-[var(--foreground)]">
      <header className="px-5 py-4 flex items-center justify-between border-b border-[var(--border)] bg-white/90 backdrop-blur">
        <Link href="/" className="flex items-center gap-2.5">
          <div
            className="h-9 w-9 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "#3200BE" }}
          >
            <Star className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="font-semibold tracking-tight leading-tight">Market Vantage</div>
            <div className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider">
              Likewize
            </div>
          </div>
        </Link>
        <Link
          href="/"
          className="text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--primary)]"
        >
          ← Home
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div
              className="mx-auto h-12 w-12 rounded-2xl flex items-center justify-center mb-4"
              style={{ backgroundColor: "var(--lw-primary-soft)" }}
            >
              <Lock className="h-5 w-5" style={{ color: "#3200BE" }} />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Enter the Likewize dashboard credentials to continue.
            </p>
          </div>

          <form
            onSubmit={onSubmit}
            className="mv-card p-6 sm:p-8 space-y-4 shadow-md"
          >
            <div>
              <label
                htmlFor="username"
                className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5"
              >
                Username
              </label>
              <input
                id="username"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full h-11 rounded-xl border border-[var(--border)] bg-white px-3.5 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--lw-primary-ring)] focus:border-[var(--primary)]"
                placeholder="Username"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full h-11 rounded-xl border border-[var(--border)] bg-white px-3.5 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--lw-primary-ring)] focus:border-[var(--primary)]"
                placeholder="Password"
              />
            </div>

            {error && (
              <div className="text-sm text-[#E11D48] bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-full text-sm font-semibold text-white disabled:opacity-60 flex items-center justify-center gap-2"
              style={{ backgroundColor: "#3200BE" }}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                "Sign in to dashboard"
              )}
            </button>
          </form>
        </div>
      </main>
      <footer className="py-6 text-center">
        <span className="inline-flex items-center justify-center gap-2 text-sm sm:text-[0.95rem] font-medium text-[var(--foreground)] tracking-tight">
          Made by Likewize Product team
          <span className="text-[var(--primary)] text-base leading-none" aria-hidden>
            ♥
          </span>
        </span>
      </footer>
    </div>
  );
}
