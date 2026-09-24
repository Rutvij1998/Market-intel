import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Bell,
  LineChart,
  Lock,
  MessageSquareReply,
  Shield,
  Sparkles,
  Users,
} from 'lucide-react';
import { ProductHubHeader } from '@/components/ProductHubHeader';

export const metadata = {
  title: 'Market Vantage · Likewize',
  description:
    'Competitive market intelligence for Likewize — sentiment, sources, business lines, AI replies, and competitor response.',
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
    icon: MessageSquareReply,
    title: 'Reply with AI',
    body: 'From any thread in the dashboard, draft a short public reply in Likewize’s we/us voice — acknowledge the issue, invite a DM or protect.likewize.com, and make sure the customer is taken care of. Edit, regenerate, and submit from the same panel.',
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
  {
    icon: Bell,
    title: 'Email alerts & digests',
    body: 'Enroll for PDF digests when new threads match your clients or business lines — so CX and Product stay ahead without living in the dashboard.',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)] text-[var(--foreground)]">
      <ProductHubHeader />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mv-hub-intro !grid-cols-1 sm:!grid-cols-[1.6fr_1fr] max-w-[1536px]">
          <div>
            <p className="eyebrow">Market Vantage</p>
            <h1>
              Market intelligence
              <br />
              for Likewize.
            </h1>
          </div>
          <p className="intro-copy">
            One place to track brand mentions, sentiment by pillar, business-line mix, and
            competitor support behavior. Sign in with your @likewize.com email to open the live app.
          </p>
        </div>
        <div className="relative max-w-[1536px] mx-auto px-5 sm:px-16 pb-16 sm:pb-20">
          <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.13em] text-[#3200BE] mb-6">
            <Lock className="h-3 w-3" />
            Likewize internal
          </div>
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
            Dashboard access is limited to @likewize.com emails via a one-time code.
          </p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-[var(--border)] bg-white">
        <div className="max-w-[1536px] mx-auto px-5 sm:px-16 py-16 sm:py-20">
          <h2 className="text-[30px] font-bold tracking-[-0.025em] text-[#142944]">
            Built for Product, CX, and Competitive Ops
          </h2>
          <p className="mt-2 text-[#607086] max-w-xl text-base leading-[1.6]">
            From source mix to drill-down threads — evidence you can act on, filtered by client and
            business line.
          </p>
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
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
                  <h3 className="font-bold tracking-tight text-[#142944] text-[20px]">
                    {f.title}
                  </h3>
                  <p className="mt-2 text-base text-[#607086] leading-[1.6]">
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
                Sign in with your @likewize.com email. After you verify the one-time code you&apos;ll
                land on the live Market Vantage dashboard.
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
