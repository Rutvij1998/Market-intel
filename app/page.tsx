import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  LineChart,
  Lock,
  Shield,
  Sparkles,
  Star,
  Users,
} from 'lucide-react';

export const metadata = {
  title: 'Market Vantage · Likewize',
  description:
    'Competitive market intelligence for Likewize — sentiment, sources, business lines, and competitor response.',
};

const features = [
  {
    icon: BarChart3,
    title: 'Source & business-line mix',
    body: 'See where Likewize conversations live — Reddit, BBB, PissedConsumer — and how volume splits across DP, HomeTech, Trade-In, Shipping, and Call Center.',
  },
  {
    icon: Sparkles,
    title: 'Real pain points, not keywords',
    body: 'Drill into concrete issues: portal friction, replacement quality, repair workmanship, shipping, deductibles — with thread-level evidence.',
  },
  {
    icon: Users,
    title: 'Competitor lens',
    body: 'Compare Likewize vs Asurion on pillars, support responsiveness (including u/Asurion_Sam), and share of voice.',
  },
  {
    icon: LineChart,
    title: 'Always current',
    body: 'Ingest from Reddit, BBB, and review sites into one dashboard your team can filter by client, line, and time range.',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)] text-[var(--foreground)]">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-white/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <div
              className="h-8 w-8 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: '#3200BE' }}
            >
              <Star className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-semibold tracking-tight truncate">Market Vantage</span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/sign-in"
              className="text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--primary)] px-2 py-1.5"
            >
              Sign in
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm"
              style={{ backgroundColor: '#3200BE' }}
            >
              Open dashboard
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 50% -10%, #3200BE 0%, transparent 55%), radial-gradient(ellipse 50% 40% at 100% 50%, #FF96FF 0%, transparent 50%)',
          }}
        />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-16 sm:pb-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--primary)] mb-6">
            <Lock className="h-3 w-3" />
            Likewize internal
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-[3.25rem] font-semibold tracking-tight leading-[1.1] max-w-3xl text-[var(--foreground)]">
            Market intelligence for Device Protection — built for Likewize.
          </h1>
          <p className="mt-5 text-base sm:text-lg text-[var(--muted-foreground)] max-w-2xl leading-relaxed">
            One place to track brand mentions, sentiment by pillar, business-line mix, and
            competitor support behavior. Sign in with the Likewize dashboard credentials to open
            the live app.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white shadow-md"
              style={{ backgroundColor: '#3200BE' }}
            >
              Sign in to dashboard
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#features"
              className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium border border-[var(--border)] bg-white hover:bg-[var(--muted)]"
            >
              See what&apos;s inside
            </a>
          </div>
          <p className="mt-4 text-xs text-[var(--muted-foreground)] flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-[var(--primary)]" />
            Dashboard access requires the shared Likewize username and password.
          </p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-[var(--border)] bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Built for Product, CX, and Competitive Ops
          </h2>
          <p className="mt-2 text-[var(--muted-foreground)] max-w-xl text-sm sm:text-base">
            From source mix to drill-down threads — evidence you can act on, filtered by client and
            business line.
          </p>
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="mv-card p-5 sm:p-6">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center mb-4"
                    style={{ backgroundColor: 'var(--lw-primary-soft)' }}
                  >
                    <Icon className="h-5 w-5" style={{ color: '#3200BE' }} />
                  </div>
                  <h3 className="font-semibold tracking-tight text-[var(--foreground)]">
                    {f.title}
                  </h3>
                  <p className="mt-2 text-sm text-[var(--muted-foreground)] leading-relaxed">
                    {f.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--border)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
          <div
            className="rounded-2xl px-6 sm:px-10 py-10 sm:py-12 text-white relative overflow-hidden"
            style={{ backgroundColor: '#3200BE' }}
          >
            <div
              className="absolute inset-0 opacity-30 pointer-events-none"
              style={{
                background:
                  'radial-gradient(circle at 90% 20%, #FF96FF 0%, transparent 45%)',
              }}
            />
            <div className="relative max-w-xl">
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                Ready when you are
              </h2>
              <p className="mt-2 text-white/80 text-sm sm:text-base leading-relaxed">
                Sign in with the Likewize team credentials. After login you&apos;ll land on the live
                Market Vantage dashboard.
              </p>
              <Link
                href="/sign-in"
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#3200BE] hover:bg-white/95"
              >
                Go to sign in
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-[var(--border)] py-7 text-center space-y-2">
        <div className="text-xs text-[var(--muted-foreground)]">
          Market Vantage · Internal use for Likewize · {new Date().getFullYear()}
        </div>
        <div className="inline-flex items-center justify-center gap-2 text-sm sm:text-[0.95rem] font-medium text-[var(--foreground)] tracking-tight">
          Made by Likewize Product team
          <span className="text-[var(--primary)] text-base leading-none" aria-hidden>
            ♥
          </span>
        </div>
      </footer>
    </div>
  );
}
