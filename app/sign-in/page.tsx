"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Star, Lock, Loader2, Mail, KeyRound, ArrowLeft } from "lucide-react";
import { DOMAIN_ERROR, isLikewizeEmail } from "@/lib/likewizeEmail";

type Step = "email" | "otp";

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/dashboard";

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestOtp(targetEmail: string) {
    const res = await fetch("/api/auth/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: targetEmail }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || "Could not send sign-in code.");
    }
    return json as { email?: string; message?: string };
  }

  async function onEmailSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!isLikewizeEmail(email)) {
      setError(DOMAIN_ERROR);
      return;
    }

    setLoading(true);
    try {
      const json = await requestOtp(email);
      setEmail(json.email || email.trim().toLowerCase());
      setOtp("");
      setStep("otp");
      setInfo(json.message || "A sign-in code has been sent to your email.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send sign-in code.");
    } finally {
      setLoading(false);
    }
  }

  async function onOtpSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setError(json?.error || "Verification failed.");
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

  async function onResend() {
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const json = await requestOtp(email);
      setOtp("");
      setInfo(json.message || "A new code has been sent.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not resend code.");
    } finally {
      setLoading(false);
    }
  }

  function useDifferentEmail() {
    setStep("email");
    setOtp("");
    setError(null);
    setInfo(null);
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
              {step === "email" ? (
                <Lock className="h-5 w-5" style={{ color: "#3200BE" }} />
              ) : (
                <KeyRound className="h-5 w-5" style={{ color: "#3200BE" }} />
              )}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {step === "email" ? "Sign in" : "Enter your code"}
            </h1>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              {step === "email"
                ? "Use your @likewize.com email to receive a one-time code."
                : `We sent a 6-digit code to ${email}.`}
            </p>
          </div>

          {step === "email" ? (
            <form
              onSubmit={onEmailSubmit}
              className="mv-card p-6 sm:p-8 space-y-4 shadow-md"
            >
              <div>
                <label
                  htmlFor="email"
                  className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5"
                >
                  Work email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full h-11 rounded-xl border border-[var(--border)] bg-white pl-10 pr-3.5 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--lw-primary-ring)] focus:border-[var(--primary)]"
                    placeholder="you@likewize.com"
                  />
                </div>
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
                    Sending code…
                  </>
                ) : (
                  "Continue"
                )}
              </button>
            </form>
          ) : (
            <form
              onSubmit={onOtpSubmit}
              className="mv-card p-6 sm:p-8 space-y-4 shadow-md"
            >
              <div>
                <label
                  htmlFor="otp"
                  className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5"
                >
                  One-time code
                </label>
                <input
                  id="otp"
                  name="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  className="w-full h-12 rounded-xl border border-[var(--border)] bg-white px-3.5 text-center text-xl tracking-[0.35em] font-semibold text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--lw-primary-ring)] focus:border-[var(--primary)]"
                  placeholder="000000"
                />
              </div>

              {info && !error && (
                <div className="text-sm text-[var(--foreground)] bg-[var(--lw-primary-soft)] border border-[var(--border)] rounded-lg px-3 py-2">
                  {info}
                </div>
              )}

              {error && (
                <div className="text-sm text-[#E11D48] bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="w-full h-11 rounded-full text-sm font-semibold text-white disabled:opacity-60 flex items-center justify-center gap-2"
                style={{ backgroundColor: "#3200BE" }}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying…
                  </>
                ) : (
                  "Verify and sign in"
                )}
              </button>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-1 text-sm">
                <button
                  type="button"
                  onClick={useDifferentEmail}
                  disabled={loading}
                  className="inline-flex items-center gap-1 text-[var(--muted-foreground)] hover:text-[var(--primary)] disabled:opacity-60"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Use a different email
                </button>
                <button
                  type="button"
                  onClick={onResend}
                  disabled={loading}
                  className="font-medium text-[var(--primary)] hover:underline disabled:opacity-60"
                >
                  Resend code
                </button>
              </div>
            </form>
          )}
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
