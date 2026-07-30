import { Suspense } from "react";

export const metadata = {
  title: "Sign in · Market Vantage",
  description: "Sign in to Market Vantage with Likewize credentials.",
};

/** Suspense boundary required for useSearchParams on the login form. */
export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="min-h-screen bg-[var(--background)]" />}>{children}</Suspense>;
}
