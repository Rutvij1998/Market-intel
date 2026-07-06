"use client";

import { useState, useEffect, useMemo } from "react";
import { Star, RefreshCw, Download, LayoutDashboard, Users, Activity } from "lucide-react";
import { motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { HealthGauge } from "@/components/dashboard/HealthGauge";
import type { ClassifiedMention, Pillar } from "@/lib/classify";
import { supabase } from "@/lib/supabase";
import { isLikewizeRelevant, isElectronicDeviceProtection, detectCompany, normalizeMentionSource, formatMentionSourceLabel, dedupeMentions, formatMentionTimeAgo, mentionDedupKey, isDashboardSource } from "@/lib/utils";
import { detectOfficialSupportReply, isRedditMention } from "@/lib/officialSupport";
import { toast } from "sonner";

// Detect obvious misconfiguration so we can show a clear banner instead of silent empty + scary console errors
const isSupabaseConfigured = !!supabase;
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, PieChart, Pie } from "recharts";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";

// Exact colors from spec
const PURPLE = "#6B46C1";
const PINK = "#EC4899";
const GREEN = "#22C55E";
const GRAY = "#64748B";
const RED = "#EF4444";

const timeRanges = ["7d", "30d", "90d", "All"] as const;

interface PillarStat {
  name: Pillar;
  positive: number;
  neutral: number;
  negative: number;
  mentions: number;
}

interface RetailerStat {
  name: string;
  mentions: number;
  positive: number;
  neutral: number;
  negative: number;
}

export default function MarketIntelDashboard() {
  const [activeRange, setActiveRange] = useState<(typeof timeRanges)[number]>("All");
  const [mentions, setMentions] = useState<ClassifiedMention[]>([]);
  const [isIngesting, setIsIngesting] = useState(false);
  const [lastIngestInfo, setLastIngestInfo] = useState<{reddit?: number; pissedconsumer?: number} | null>(null);
  const [dbLoadMeta, setDbLoadMeta] = useState<{ raw: number; shown: number } | null>(null);
  const [selectedInsight, setSelectedInsight] = useState<ClassifiedMention | null>(null);

  // Tab navigation: Overview + Competitor Analysis
  const [activeTab, setActiveTab] = useState<'overview' | 'competitor'>('overview');
  // Used to mount Recharts ResponsiveContainers only on client + when tab active
  const [competitorMounted, setCompetitorMounted] = useState(false);

  // Drill down on pillar breakdown
  const [drillPillar, setDrillPillar] = useState<Pillar | null>(null);
  const [hoveredPillar, setHoveredPillar] = useState<Pillar | null>(null);

  // Load any previously persisted real mentions from Supabase (for cumulative volume across runs)
  // Normalizes new schema (content, retailer, raw_data) to the app's ClassifiedMention shape (text, client, etc.)
  async function loadFromSupabase() {
    if (!supabase) return [];
    try {
      const pageSize = 1000;
      let from = 0;
      let data: any[] = [];
      while (true) {
        const { data: page, error: pageError } = await supabase
          .from('mentions')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1);
        if (pageError) {
          console.error("loadFromSupabase page error:", pageError);
          break;
        }
        if (!page?.length) break;
        data = data.concat(page);
        if (page.length < pageSize) break;
        from += pageSize;
      }

      if (!data.length) {
        setDbLoadMeta({ raw: 0, shown: 0 });
        return [];
      }

      const normalized = (data as any[]).map((row: any) => {
        const raw = row.raw_data || {};
        const hay = `${row.content || ''} ${row.text || ''} ${raw.full_thread || ''}`;
        const company = (row.company || row.competitor || raw.company || raw.competitor || detectCompany(hay) || 'Other') as ClassifiedMention['company'];
        // Note: if 'company' column doesn't exist in your table yet, it safely falls back to raw_data.company
        // Run the ALTERs from the migration to add top-level columns:
        // ALTER TABLE mentions ADD COLUMN IF NOT EXISTS company TEXT;
        // ALTER TABLE mentions ADD COLUMN IF NOT EXISTS competitor TEXT;
        // etc.
        const productType = (row.product_type || raw.product_type || 'electronic_device_protection') as any;
        const retailerContext = row.retailer || raw.retailer_context || raw.client || row.subreddit || raw.subreddit;

        const mention = {
          id: row.id || raw.reddit_id || `db-${Date.now()}`,
          text: row.content || row.text || '',
          source: normalizeMentionSource(raw.source || row.source, {
            url: row.url,
            id: raw.reddit_id || row.reddit_id,
          }),
          url: row.url || '',
          created_at: row.created_at,
          sentiment: row.sentiment,
          pillar: row.pillar,
          confidence: row.confidence,
          key_issue: undefined,
          client: retailerContext,
          subreddit: row.subreddit || raw.subreddit,
          title: row.title,
          rating: raw.rating ?? row.rating,
          company,
          product_type: productType,
          is_relevant: raw.product_type !== 'other',
          retailer_context: retailerContext,
          full_thread: raw.full_thread || raw.original?.full_thread || '',
          comments: (raw.comments || raw.original?.comments || []) as any[],
          has_official_reply: false,
          first_official_reply_hours: null,
          official_replier: null,
        } as ClassifiedMention;

        if (isRedditMention(mention.source) && (company === 'Asurion' || company === 'Likewize')) {
          const support = detectOfficialSupportReply({
            company,
            comments: mention.comments,
            full_thread: mention.full_thread,
            created_at: mention.created_at,
          });
          mention.has_official_reply = support.has_official_reply;
          mention.first_official_reply_hours = support.first_official_reply_hours;
          mention.official_replier = support.official_replier;
        } else if (raw.has_official_reply && !['likewize', 'asurion'].includes(String(raw.official_replier || '').toLowerCase())) {
          mention.has_official_reply = raw.has_official_reply;
          mention.first_official_reply_hours = raw.first_official_reply_hours ?? null;
          mention.official_replier = raw.official_replier ?? null;
        }

        return mention;
      });

      // Dashboard uses Reddit + PissedConsumer only — show everything saved from those sources.
      const sourceOnly = normalized.filter((m) => isDashboardSource(m.source));

      if (sourceOnly.length !== normalized.length) {
        console.log(`[loadFromSupabase] Source filter (Reddit + PissedConsumer): ${sourceOnly.length}/${normalized.length}`);
      }
      const deduped = dedupeMentions(sourceOnly);
      setDbLoadMeta({ raw: normalized.length, shown: deduped.length });
      console.log(`[loadFromSupabase] Loaded ${deduped.length} records (${normalized.length} raw rows in DB).`);
      return deduped;
    } catch {
      return [];
    }
  }

  // Always load existing data from Supabase immediately on mount/refresh (device protection only).
  // Overview tab focuses on Likewize; Competitor tab compares Asurion + SquareTrade.
  // No auto heavy work on load.
  useEffect(() => {
    loadFromSupabase().then(setMentions);
  }, []); // run once on mount (remounts on hard refresh)

  // When competitor tab becomes active, mount the chart containers on next tick so they have real layout size.
  useEffect(() => {
    if (activeTab === 'competitor') {
      const t = setTimeout(() => setCompetitorMounted(true), 0);
      return () => clearTimeout(t);
    } else {
      setCompetitorMounted(false);
    }
  }, [activeTab]);

  // NOTE: mergeMentions is legacy/unused. 
  // INVARIANT (strictly enforced for Overview + Competitor tabs):
  // - Page ALWAYS starts by loading from Supabase (useEffect on mount).
  // - All visualization data (health, pillars, retailer stats, recentInsights, likewizeMentions, asurionMentions,
  //   allstateMentions, pillarBreakdownByCompetitor, radarData, comps, competitorMentions, etc.) is derived
  //   exclusively from the `mentions` state.
  // - `mentions` state is populated ONLY via loadFromSupabase() (SELECT + normalize + device filter).
  // - Manual "Sync Data Sources" or cron triggers runIngestion(), which ALWAYS does supabaseAdmin.upsert() first for every item.
  // - The /api/ingest/all route now returns immediately (fire-and-forget the scrape/classify/upsert work).
  // - After background work, UI must explicitly call "Refresh from Database" to pull the newly pushed rows. No scrape result is ever used directly to set UI state.
  // This guarantees: Supabase is the single source of truth. Dashboard never shows unsaved scrape data.
  const currentMentions = mentions; // ONLY real data loaded from Supabase (no synthetic, no direct ingest result)

  // Client-side date range filter (makes 7d/30d/90d/All actually work)
  function filterByDateRange(data: ClassifiedMention[], range: string): ClassifiedMention[] {
    if (range === 'All') return data;
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return data.filter(m => {
      const mDate = new Date(m.created_at);
      // Only include if valid date and within range. Invalid dates are included to avoid hiding data.
      if (isNaN(mDate.getTime())) return true;
      return mDate >= cutoff;
    });
  }

  const timeFiltered = filterByDateRange(currentMentions, activeRange);

  // All Reddit + PissedConsumer mentions in the selected time window
  const filteredMentions = timeFiltered;
  const ecosystemTotal = filteredMentions.length;

  const sourceDistribution = useMemo(() => {
    const redditCount = filteredMentions.filter((m) => (m.source || '').toLowerCase().includes('reddit')).length;
    const pcCount = filteredMentions.filter((m) => (m.source || '').toLowerCase().includes('pissed')).length;
    return [
      { source: 'Reddit', count: redditCount, fill: PURPLE },
      { source: 'PissedConsumer', count: pcCount, fill: '#EF4444' },
    ];
  }, [filteredMentions]);

  // Overview tab is Likewize-focused (health, pillars, recent insights, retailer context for Likewize plans).
  // We filter here so that Asurion/Allstate posts (now correctly ingested for the Competitor tab)
  // do not pollute the main Sentiment Overview / health score / Likewize pillar breakdown.
  // Competitor tab derives its own sets below using explicit m.company === 'Asurion' etc.
  const overviewMentions = useMemo(() => {
    let base = filteredMentions.filter(m =>
      m.company === 'Likewize' || (!m.company && isLikewizeRelevant(m as any))
    );
    if (drillPillar) {
      base = base.filter(m => m.pillar === drillPillar);
    }
    return base;
  }, [filteredMentions, drillPillar]);

  const hasData = overviewMentions.length > 0;
  const likewizeTotal = overviewMentions.length;
  const total = ecosystemTotal;
  const positiveCount = overviewMentions.filter(m => m.sentiment === 'positive').length;
  const neutralCount = overviewMentions.filter(m => m.sentiment === 'neutral').length;
  const negativeCount = overviewMentions.filter(m => m.sentiment === 'negative').length;

  // Health score = positive % + neutral % (non-negative sentiment share).
  const healthScore = likewizeTotal > 0
    ? Math.round(((positiveCount + neutralCount) / likewizeTotal) * 100)
    : 0;

  const breakdown = likewizeTotal > 0 ? {
    positive: Math.round((positiveCount / likewizeTotal) * 100),
    neutral: Math.round((neutralCount / likewizeTotal) * 100),
    negative: Math.round((negativeCount / likewizeTotal) * 100),
  } : { positive: 0, neutral: 0, negative: 0 };

  // Pillar breakdown (aggregated from the date-filtered real data) — Likewize overview
  const pillarStats: PillarStat[] = (['Claims', 'Repair', 'Replacement', 'Customer Service'] as Pillar[]).map(name => {
    const pillarMentions = overviewMentions.filter(m => m.pillar === name);
    if (pillarMentions.length === 0) {
      return { name, positive: 0, neutral: 0, negative: 0, mentions: 0 };
    }
    const pTotal = pillarMentions.length;
    const pos = Math.round((pillarMentions.filter(m => m.sentiment === 'positive').length / pTotal) * 100);
    const neu = Math.round((pillarMentions.filter(m => m.sentiment === 'neutral').length / pTotal) * 100);
    const neg = 100 - pos - neu;
    return {
      name,
      positive: pos,
      neutral: neu,
      negative: neg,
      mentions: pillarMentions.length,   // actual count in the selected date range (no hardcoded fallback)
    };
  });

  // Retailer / Client breakdown (from retailer subreddits like r/Newegg → "Newegg")
  // Aggregated from filtered real Reddit data for Likewize context. Uses client (mapped) or falls back to subreddit.
  const retailerStats: RetailerStat[] = useMemo(() => {
    const groups = new Map<string, ClassifiedMention[]>();
    overviewMentions.forEach(m => {
      const key = (m as any).client || (m as any).subreddit || 'Other/Direct';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    });
    return Array.from(groups.entries())
      .map(([name, ms]) => {
        const pos = ms.filter(x => x.sentiment === 'positive').length;
        const neu = ms.filter(x => x.sentiment === 'neutral').length;
        const neg = ms.filter(x => x.sentiment === 'negative').length;
        return { name, mentions: ms.length, positive: pos, neutral: neu, negative: neg };
      })
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 10);
  }, [overviewMentions]);

  // Recent Insights for Overview — Likewize focused (the main mentions set for overview).
  const recentInsights = dedupeMentions([...overviewMentions])
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 15);

  // =====================================================
  // COMPETITOR DATA (for Competitor Analysis tab) - respects active time range
  // IMPORTANT: All of this is derived from the `mentions` state, which is *always*
  // populated exclusively via loadFromSupabase() (initial mount + after every ingest).
  // Ingest first pushes to Supabase (via supabaseAdmin.upsert in runIngestion), then we reload.
  // Same source of truth as the Overview tab. No direct use of ingest "incoming" data for UI.
  // =====================================================
  const timeFilteredCompetitorBase = timeFiltered; // already device protection filtered + time

  // Competitor filters: prefer explicit company tag (from classification or raw_data).
  // Fallback to text match so that data loaded from Supabase (even old rows or rows where
  // classification only set sentiment/pillar) still appears for Asurion/Allstate etc.
  // This fixes "competitor tab isnt loading the data at all".
  const textContains = (m: any, re: RegExp) => re.test(`${m.text || ''} ${m.title || ''} ${(m as any).full_thread || ''}`.toLowerCase());

  const likewizeMentions = timeFilteredCompetitorBase.filter(m => 
    m.company === 'Likewize' || (!m.company && isLikewizeRelevant(m as any))
  );
  const asurionMentions = timeFilteredCompetitorBase.filter(m => 
    m.company === 'Asurion' || (!m.company && textContains(m, /asurion/))
  );
  const allstateMentions = timeFilteredCompetitorBase.filter(m => 
    m.company === 'Allstate' || (!m.company && textContains(m, /allstate|all state/))
  );
  const squaretradeMentions = timeFilteredCompetitorBase.filter(m => 
    m.company === 'SquareTrade' || (!m.company && textContains(m, /squaretrade|square trade/))
  );
  const otherCompetitorMentions = timeFilteredCompetitorBase.filter(m => 
    m.company && !['Likewize', 'Asurion', 'Allstate', 'SquareTrade'].includes(m.company)
  );

  const competitorMentions = [...asurionMentions, ...allstateMentions, ...squaretradeMentions, ...otherCompetitorMentions];

  // Debug visibility for "competitor tab isnt loading data"
  console.log('[CompetitorData] counts (time-filtered from Supabase):', {
    asurion: asurionMentions.length,
    allstate: allstateMentions.length,
    squaretrade: squaretradeMentions.length,
    likewizeRef: likewizeMentions.length,
    totalInWindow: timeFiltered.length,
    totalLoaded: mentions.length
  });

  // Simple derived competitor metrics (from real data where possible)
  function computeStats(arr: ClassifiedMention[]) {
    if (!arr.length) return { count: 0, pos: 0, neg: 0, posPct: 0, avgRating: null as number | null };
    const pos = arr.filter(m => m.sentiment === 'positive').length;
    const neg = arr.filter(m => m.sentiment === 'negative').length;
    const rated = arr.filter(m => typeof m.rating === 'number');
    const avgRating = rated.length ? rated.reduce((s, m) => s + (m.rating || 0), 0) / rated.length : null;
    return {
      count: arr.length,
      pos,
      neg,
      posPct: Math.round((pos / arr.length) * 100),
      avgRating: avgRating ? Math.round(avgRating * 10) / 10 : null,
    };
  }

  const likewizeStats = computeStats(likewizeMentions);
  const asurionStats = computeStats(asurionMentions);
  const allstateStats = computeStats(allstateMentions);
  const squaretradeStats = computeStats(squaretradeMentions);

  // Pillar-wise breakdown for competitor comparison (time filtered)
  // Focus on user's key pillars: Claims, Repair, Replacement, Reimbursements, Call Center
  const userPillars = ['Claims', 'Repair', 'Replacement', 'Reimbursements', 'Call Center'];
  const pillarBreakdownByCompetitor = userPillars.map(pillar => {
    const l = likewizeMentions.filter(m => m.pillar === pillar);
    const a = asurionMentions.filter(m => m.pillar === pillar);
    const al = allstateMentions.filter(m => m.pillar === pillar);
    const s = squaretradeMentions.filter(m => m.pillar === pillar);
    const calc = (arr: ClassifiedMention[]) => arr.length ? Math.round((arr.filter(m => m.sentiment === 'positive').length / arr.length) * 100) : 0;
    return {
      pillar,
      likewize: calc(l),
      asurion: calc(a),
      allstate: calc(al),
      squaretrade: calc(s),
      likewizeCount: l.length,
      asurionCount: a.length,
      allstateCount: al.length,
      squaretradeCount: s.length,
    };
  });

  // Enhanced computations for Competitor tab (derived from real Supabase data, time-filtered, device protection only)
  const getAvgRatingScore = (arr: ClassifiedMention[]) => {
    const rated = arr.filter(m => typeof m.rating === 'number');
    if (!rated.length) return null; // real data only
    return Math.round((rated.reduce((s, m) => s + (m.rating || 0), 0) / rated.length) / 5 * 100);
  };
  const getReplacementPos = (arr: ClassifiedMention[]) => {
    const repl = arr.filter(m => m.pillar === 'Replacement');
    if (!repl.length) return null;
    return Math.round(repl.filter(m => m.sentiment === 'positive').length / repl.length * 100);
  };
  const getSentimentScore = (arr: ClassifiedMention[]) => arr.length ? Math.round(arr.filter(m => m.sentiment === 'positive').length / arr.length * 100) : null;

  // New retention/recovery metric: % of negative mentions that have positive recovery language in the thread (bot/company response)
  function computeRecoveryRate(arr: ClassifiedMention[]) {
    if (!arr.length) return 0;
    let negatives = 0;
    let recovered = 0;
    arr.forEach(m => {
      if (m.sentiment !== 'negative') return;
      negatives++;
      const thread = String((m as any).full_thread || (m as any).raw_data?.full_thread || m.text || '').toLowerCase();
      const companyHint = (m.company || '').toLowerCase();
      // Heuristic for positive reply / resolution language from support/bot
      const positiveRecovery = /(sorry|we('re| are|'ve)|happy to|glad|thank you|replacement sent|we('ve| have) (sent|resolved|fixed|helped)|support team|we can help|looking into this|appreciate your patience|issue has been|resolved for you)/.test(thread);
      const hasCompanyContext = !companyHint || thread.includes(companyHint) || thread.includes('support') || thread.includes('team') || thread.includes('bot');
      if (positiveRecovery && hasCompanyContext) recovered++;
    });
    return negatives > 0 ? Math.round((recovered / negatives) * 100) : 0;
  }

  // Official support = real Reddit comment authors only (Asurion_Sam / likewize_* support accounts).
  // Never uses stale DB flags or brand-name mentions in post text.
  function getSupportResponsiveness(mentions: any[], company: 'Asurion' | 'Likewize') {
    const redditThreads = (mentions || []).filter((m) => isRedditMention(m.source));
    if (!redditThreads.length) {
      return { responseRate: 0, officialReplies: 0, totalThreads: 0, avgReplyHours: null as number | null };
    }

    let replied = 0;
    const replyTimes: number[] = [];

    redditThreads.forEach((m: any) => {
      const support = detectOfficialSupportReply({
        company,
        comments: m.comments || (m as any).raw_data?.comments || (m as any).raw_data?.original?.comments || [],
        full_thread: m.full_thread || (m as any).raw_data?.full_thread,
        created_at: m.created_at,
      });

      if (support.has_official_reply) {
        replied++;
        if (typeof support.first_official_reply_hours === 'number' && support.first_official_reply_hours > 0) {
          replyTimes.push(support.first_official_reply_hours);
        }
      }
    });

    const rate = Math.round((replied / redditThreads.length) * 100);
    const avg = replyTimes.length > 0
      ? Math.round((replyTimes.reduce((a, b) => a + b, 0) / replyTimes.length) * 10) / 10
      : null;

    return {
      responseRate: rate,
      officialReplies: replied,
      totalThreads: redditThreads.length,
      avgReplyHours: avg,
    };
  }

  const asurionSupport = getSupportResponsiveness(asurionMentions, 'Asurion');
  const likewizeSupport = getSupportResponsiveness(likewizeMentions, 'Likewize');

  // Reusable clean hover popup for comparison charts (consistent card style with dashboard)
  const CustomComparisonTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xl min-w-[220px] text-sm">
        <div className="font-semibold tracking-tight text-[#0F172A] mb-2 text-base border-b pb-1.5">{label}</div>
        <div className="space-y-2 pt-1">
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <div 
                  className="w-3 h-3 rounded-full flex-shrink-0" 
                  style={{ backgroundColor: entry.color }} 
                />
                <span className="text-[#475569] font-medium">{entry.name}</span>
              </div>
              <span className="font-semibold tabular-nums text-[#0F172A]">{entry.value}%</span>
            </div>
          ))}
        </div>
        <div className="text-[10px] text-[#94a3b8] mt-2.5 pt-1.5 border-t">Positive sentiment % on this pillar</div>
      </div>
    );
  };

  const radarData = pillarBreakdownByCompetitor.map(p => ({
    subject: p.pillar,
    Likewize: p.likewize,
    Asurion: p.asurion,
    Allstate: p.allstate,
    SquareTrade: p.squaretrade,
  }));

  // Focused on Likewize + Asurion only for the grouped bar (other competitors removed per request)
  const asurionLikewizeRadarData = radarData.map(d => ({
    subject: d.subject,
    Likewize: d.Likewize,
    Asurion: d.Asurion,
  }));

  // Dynamic Y-axis max based on actual data (not hardcoded 100)
  const rawMax = Math.max(
    0,
    ...radarData.flatMap(d => [d.Likewize || 0, d.Asurion || 0, d.Allstate || 0, d.SquareTrade || 0])
  );
  const yDomainMax = rawMax > 0 ? Math.ceil(rawMax / 10) * 10 : 100;

  // For highlights - only real data (no synthetic 50s)
  const comps = [
    { name: 'Likewize', avg: getAvgRatingScore(likewizeMentions), res: getReplacementPos(likewizeMentions), sent: getSentimentScore(likewizeMentions) },
    { name: 'Asurion', avg: getAvgRatingScore(asurionMentions), res: getReplacementPos(asurionMentions), sent: getSentimentScore(asurionMentions) },
  ].filter(c => c.avg != null || c.res != null || c.sent != null);

  const bestRatingComp = comps.length && comps.some(c => c.avg != null) ? [...comps].sort((a,b) => (b.avg || 0) - (a.avg || 0))[0] : null;
  const fastestResComp = comps.length && comps.some(c => c.res != null) ? [...comps].sort((a,b) => (b.res || 0) - (a.res || 0))[0] : null;
  const leaderSent = comps.length ? Math.max(...comps.map(c => c.sent || 0)) : 0;
  const likewizeSentScore = getSentimentScore(likewizeMentions) || 0;
  const sentGap = Math.round(leaderSent - likewizeSentScore);

  // === Ingest action ===
  // mode='full' for initial when no data; 'update' for incremental/refresh when data exists.
  // Always reloads from Supabase after to ensure single source of truth and fast subsequent loads.
  // Quick reload of whatever is currently in Supabase (no new Reddit/TP/BBB fetch or classification).
  // Useful after a background ingest has finished writing competitor rows.
  async function refreshFromDatabase() {
    if (!supabase) {
      toast.error('Supabase not configured — cannot refresh.');
      return;
    }
    try {
      await fetch('/api/ingest/repair-sources?fast=1', { method: 'POST' }).catch(() => null);
      const fromDb = await loadFromSupabase();
      if (fromDb.length > 0) {
        setMentions(fromDb);
        toast.success(`Loaded ${fromDb.length} records from the database`);
      } else {
        toast('No new data in the database for current filters.');
      }
    } catch (e) {
      console.error(e);
      toast.error('Refresh from Database failed — see console.');
    }
  }

  async function handleIngestAll(isFull = false, isAuto = false) {
    setIsIngesting(true);
    // Seamless: shoot request (backend handles async + Supabase writes), UI stays interactive.
    fetch('/api/ingest/all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: isFull ? 'full' : 'update' }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) throw new Error(json.error || 'start failed');
        if (json.sources) setLastIngestInfo(json.sources);
        if (!isAuto) {
          toast.success('Sync started in background', { description: 'Data is being fetched from sources and saved to the database. Click "Refresh from Database" to load the latest results.' });
        }
      })
      .catch((e: any) => {
        if (!isAuto) toast.error('Sync failed to start (check console + .env)');
        console.error('handleIngestAll:', e);
      })
      .finally(() => setTimeout(() => setIsIngesting(false), 550));
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-[#F8FAFC] text-[#0F172A]">
      {/* 1. Left Sidebar - Purple theme (collapses on mobile) */}
      <div
        className="w-full lg:w-64 flex-shrink-0 text-white flex flex-row lg:flex-col overflow-x-auto lg:overflow-visible"
        style={{ backgroundColor: PURPLE }}
      >
        <div className="p-6 flex items-center gap-3 border-b border-white/20">
          <div className="h-9 w-9 rounded-full bg-white flex items-center justify-center">
            <Star className="h-5 w-5" style={{ color: PURPLE }} />
          </div>
          <div>
            <div className="font-semibold text-lg tracking-tight">Likewize</div>
            <div className="text-[10px] text-white/70 -mt-1 font-medium tracking-widest">MARKET INTEL</div>
          </div>
        </div>

        <div className="p-4 flex-1">
          <nav className="space-y-1 text-sm">
            {[
              { label: "Overview", tab: 'overview' as const, icon: LayoutDashboard },
              { label: "Competitor Analysis", tab: 'competitor' as const, icon: Users },
            ].map((item) => {
              const isActive = (item.tab === 'competitor' && activeTab === 'competitor') || (item.tab === 'overview' && activeTab === 'overview');
              const Icon = item.icon;
              return (
                <a
                  key={item.label}
                  href="#"
                  onClick={(e) => { e.preventDefault(); setActiveTab(item.tab); }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md transition cursor-pointer ${isActive ? "font-medium bg-white/10" : "text-white/80 hover:text-white hover:bg-white/10"}`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </a>
              );
            })}
          </nav>
        </div>

        {/* Bottom mini Sentiment Health in sidebar - Lovable style */}
        <div className="m-4 p-3 rounded-xl bg-white/10 border border-white/20">
          <div className="text-[10px] uppercase tracking-widest text-white/70 mb-1 flex items-center gap-1">
            <Activity className="h-3 w-3" /> Sentiment Health · {activeRange}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold">{healthScore}</span>
            <span className="text-xs text-white/70">/100</span>
          </div>
          <div className="text-xs text-emerald-300 mt-0.5">+0 vs prior period</div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top header controls */}
        <div className="border-b bg-white px-4 lg:px-6 py-2 lg:py-3 flex items-center gap-2 lg:gap-3 flex-wrap">
          <div className="flex items-center rounded-full border bg-white p-0.5 text-xs lg:text-sm shadow-sm order-2 lg:order-none">
            {timeRanges.map((range) => (
              <button
                key={range}
                onClick={() => setActiveRange(range)}
                className={`px-2.5 lg:px-3 py-0.5 lg:py-1 rounded-full transition font-medium ${activeRange === range ? "bg-[#6B46C1] text-white shadow" : "text-[#64748B] hover:bg-gray-100"}`}
              >
                {range}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          <Button
            onClick={() => handleIngestAll(false)}
            disabled={isIngesting}
            style={{ backgroundColor: PURPLE }}
            className="text-white hover:brightness-110 gap-1.5 lg:gap-2 text-xs lg:text-sm order-1 lg:order-none"
            size="sm"
          >
            {isIngesting ? <RefreshCw className="h-3 w-3 lg:h-4 lg:w-4 animate-spin" /> : <Download className="h-3 w-3 lg:h-4 lg:w-4" />}
            {isIngesting ? "Syncing..." : "Sync Data Sources"}
          </Button>

          <Button
            onClick={refreshFromDatabase}
            variant="outline"
            size="sm"
            className="text-xs lg:text-sm"
          >
            Refresh from Database
          </Button>
        </div>

        <div className="p-5 lg:p-6 space-y-4 lg:space-y-6 flex-1 overflow-auto">
          {activeTab === 'overview' ? (
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-2xl lg:text-[26px] font-semibold tracking-[-0.3px]">Sentiment Overview</h1>
              <p className="text-[#64748B] text-sm mt-0.5">Live market intelligence across the Likewize ecosystem</p>
            </div> 
          </div>
            ) : (
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-2xl lg:text-[26px] font-semibold tracking-[-0.3px]">Competitor Analysis</h1>
              <p className="text-[#64748B] text-sm mt-0.5">Likewize vs Asurion / SquareTrade • Device Protection</p>
            </div> 
          </div>
            )}
            <div className="inline-flex items-center gap-2 text-xs mt-3">
              <div className="px-2.5 py-0.5 rounded-md bg-[#6B46C1]/10 text-[#6B46C1] font-medium tracking-wide">
                {activeTab === 'overview' 
                  ? `All sources • ${ecosystemTotal} mentions (${likewizeTotal} Likewize)`
                  : `Competitor • ${competitorMentions.length} mentions`}
              </div>
              <div className="text-[#94A3B7]">•</div>
              <div className="text-[#64748B]">{activeRange} window</div>
              {lastIngestInfo && (
                <div className="text-[10px] text-[#94A3B7] ml-1">
                  Synced: {lastIngestInfo.reddit || 0} Reddit / {lastIngestInfo.pissedconsumer || 0} PissedConsumer
                  {dbLoadMeta ? ` • DB: ${dbLoadMeta.shown} shown` : ''}
                </div>
              )}
            </div>

          {activeTab === 'overview' && (
          <>
          {!isSupabaseConfigured && (
            <div className="rounded-xl border p-4 bg-red-50 border-red-200 text-red-800 text-sm">
              <div className="font-semibold mb-1">⚠️ Supabase not configured (Invalid API key on load)</div>
              <div>
                Edit <span className="font-mono bg-red-100 px-1 rounded">market-intel/.env.local</span> and replace the Supabase lines with your real values.
              </div>
            </div>
          )}

          {/* KPI Cards - 4 clean evenly spaced cards */}
          <motion.div 
            className="grid grid-cols-2 md:grid-cols-4 gap-4"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut", delay: 0.05 }}
          >
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5">
              <div className="text-[10px] text-[#64748B] font-medium tracking-wide">TOTAL MENTIONS</div>
              <div className="text-2xl font-semibold mt-1 text-[#1E293B] tabular-nums">{total}</div>
              <div className="text-[10px] text-emerald-600">Reddit + PissedConsumer • {activeRange}</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5">
              <div className="text-[10px] text-[#64748B] font-medium tracking-wide">POSITIVE SENTIMENT</div>
              <div className="text-2xl font-semibold mt-1" style={{color: GREEN}}>{breakdown.positive}%</div>
              <div className="text-[10px] text-[#64748B] tabular-nums">{positiveCount} of {likewizeTotal} Likewize</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5">
              <div className="text-[10px] text-[#64748B] font-medium tracking-wide">TOP RETAILER</div>
              <div className="text-xl font-semibold mt-1 text-[#1E293B] truncate">{retailerStats[0]?.name || "—"}</div>
              <div className="text-[10px] text-[#64748B]">{retailerStats[0]?.mentions || 0} mentions</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5">
              <div className="text-[10px] text-[#64748B] font-medium tracking-wide">HEALTH</div>
              <div className="text-2xl font-semibold mt-1" style={{color: healthScore > 40 ? GREEN : healthScore > 20 ? "#F59E0B" : RED}}>{healthScore}</div>
              <div className="text-[10px] text-[#64748B]">Positive + Neutral • {activeRange}</div>
            </div>
          </motion.div>

          <div className="bg-white rounded-2xl border p-5 shadow-sm">
            <div className="font-semibold tracking-tight text-base">SOURCE DISTRIBUTION</div>
            <div className="text-[11px] text-[#64748B] mb-4">Reddit vs PissedConsumer in the selected time window</div>
            {sourceDistribution.some((s) => s.count > 0) ? (
              <div className="flex flex-col items-center">
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={sourceDistribution}
                        dataKey="count"
                        nameKey="source"
                        cx="50%"
                        cy="50%"
                        outerRadius={88}
                        paddingAngle={2}
                        label={({ name, percent }) => `${name} ${Math.round((percent || 0) * 100)}%`}
                        labelLine={false}
                      >
                        {sourceDistribution.map((entry, index) => (
                          <Cell key={`source-pie-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name) => [`${value ?? 0} mentions`, name]}
                        contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-sm w-full max-w-md">
                  {sourceDistribution.map((s) => {
                    const pct = ecosystemTotal > 0 ? Math.round((s.count / ecosystemTotal) * 100) : 0;
                    return (
                      <div key={s.source} className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.fill }} />
                        <span className="text-[#64748B]">{s.source}</span>
                        <span className="ml-auto font-medium tabular-nums text-[#1E293B]">{s.count} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="h-[120px] flex items-center justify-center text-sm text-[#64748B] border border-dashed rounded-xl">
                No source data in this window. Sync and refresh from the database.
              </div>
            )}
          </div>

          {/* Main two-column area: Sentiment Health + Pillar Breakdown (Lovable layout) */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* SENTIMENT HEALTH Card - left, with gauge + breakdown */}
            <div className="lg:col-span-2 bg-white rounded-2xl border p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold tracking-wide text-[#0F172A]">SENTIMENT HEALTH</div>
                <span className="text-purple-500">✨</span>
              </div>

              <div className="flex justify-center mb-2">
                {hasData ? (
                  <HealthGauge score={healthScore} />
                ) : (
                  <div className="w-[260px] h-[150px] flex items-center justify-center rounded-full border-2 border-dashed border-gray-300 text-center text-sm text-[#64748B]">
                    No real data yet
                  </div>
                )}
              </div>

              {/* Breakdown like Lovable - clean, no overlapping text */}
              <div className="flex justify-between text-center text-sm mt-1">
                <div className="flex-1">
                  <div className="font-semibold" style={{color: GREEN}}>{breakdown.positive}%</div>
                  <div className="text-[10px] text-[#64748B]">POSITIVE</div>
                </div>
                <div className="flex-1">
                  <div className="font-semibold" style={{color: GRAY}}>{breakdown.neutral}%</div>
                  <div className="text-[10px] text-[#64748B]">NEUTRAL</div>
                </div>
                <div className="flex-1">
                  <div className="font-semibold" style={{color: RED}}>{breakdown.negative}%</div>
                  <div className="text-[10px] text-[#64748B]">NEGATIVE</div>
                </div>
              </div>
            </div>

            {/* PILLAR BREAKDOWN Card - right, with stacked bars + 4 cards */}
            <div className="lg:col-span-3 bg-white rounded-2xl border p-4 lg:p-5 shadow-sm">
              {/* Header */}
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-semibold tracking-tight text-base">PILLAR BREAKDOWN</div>
                  <div className="text-[11px] text-[#64748B]">Hover for breakdown • Click to drill down</div>
                </div>
                <div className="text-[10px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-500 tabular-nums whitespace-nowrap">Last {activeRange}</div>
              </div>

              {drillPillar && (
                <div className="mb-2 inline-flex items-center gap-1 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                  Filtered to: {drillPillar} <button onClick={() => setDrillPillar(null)} className="ml-1 font-bold">× clear</button>
                </div>
              )}

              {/* Labels row */}
              <div className="flex gap-2 lg:gap-3 mb-1">
                {pillarStats.map((p, idx) => {
                  const isDrilled = drillPillar === p.name;
                  return (
                    <div 
                      key={idx} 
                      onClick={() => setDrillPillar(drillPillar === p.name ? null : p.name as Pillar)}
                      className={`flex-1 text-center cursor-pointer transition ${isDrilled ? 'ring-1 ring-[#6B46C1] rounded' : ''}`}
                    >
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#1E1B4B", lineHeight: "1.1" }}>{p.name}</div>
                    </div>
                  );
                })}
              </div>

              {/* Bars with Y-axis and X-axis */}
              <div className="flex gap-1 mb-1">
                {/* Y-axis */}
                <div className="relative flex-shrink-0 w-8 text-[9px] text-[#64748B] flex flex-col justify-between h-28 lg:h-32">
                  <div className="text-right leading-none">100%</div>
                  <div className="text-right leading-none">75%</div>
                  <div className="text-right leading-none">50%</div>
                  <div className="text-right leading-none">25%</div>
                  <div className="text-right leading-none">0%</div>
                  {/* Vertical Y-axis line */}
                  <div className="absolute top-0 bottom-0 right-0 border-r border-slate-300"></div>
                </div>

                {/* Bars area with X-axis */}
                <div className="flex-1 relative h-28 lg:h-32">
                  {/* Light gridlines */}
                  <div className="absolute inset-0 z-0 pointer-events-none">
                    <div className="absolute left-0 right-0 top-[25%] border-t border-slate-200/40"></div>
                    <div className="absolute left-0 right-0 top-[50%] border-t border-slate-200/40"></div>
                    <div className="absolute left-0 right-0 top-[75%] border-t border-slate-200/40"></div>
                  </div>

                  <div className="flex gap-2 lg:gap-3 h-full">
                    {pillarStats.map((p, idx) => {
                      const posPct = p.positive || 0;
                      const neuPct = p.neutral || 0;
                      const negPct = p.negative || 0;
                      const posColor = "#00BA88";
                      const neuColor = "#5F6073";
                      const negColor = "#FF0055";
                      const isDrilled = drillPillar === p.name;
                      const isHovered = hoveredPillar === p.name;
                      return (
                        <div 
                          key={idx} 
                          className={`flex-1 flex justify-center group min-w-0 cursor-pointer transition ${isDrilled ? 'ring-1 ring-[#6B46C1] rounded' : ''}`}
                          onMouseEnter={() => setHoveredPillar(p.name as Pillar)}
                          onMouseLeave={() => setHoveredPillar(null)}
                          onClick={() => setDrillPillar(drillPillar === p.name ? null : p.name as Pillar)}
                        >
                          <div className="relative w-12 lg:w-16 h-full">
                            <div 
                              className={`relative w-full h-full bg-transparent rounded-t-lg overflow-hidden border border-slate-200 transition-all duration-200 group-hover:border-slate-300 ${isHovered ? 'scale-[1.02] shadow-sm' : ''}`}
                            >
                              {negPct > 0 && (
                                <div className="absolute left-0 right-0 transition-all duration-500 ease-out rounded-t" style={{ backgroundColor: negColor, height: `${negPct}%`, bottom: `${posPct + neuPct}%` }} />
                              )}
                              {neuPct > 0 && (
                                <div className={`absolute left-0 right-0 transition-all duration-500 ease-out ${negPct === 0 ? 'rounded-t' : ''}`} style={{ backgroundColor: neuColor, height: `${neuPct}%`, bottom: `${posPct}%` }} />
                              )}
                              {posPct > 0 && (
                                <div className={`absolute left-0 right-0 transition-all duration-500 ease-out ${negPct === 0 && neuPct === 0 ? 'rounded-t' : ''}`} style={{ backgroundColor: posColor, height: `${posPct}%`, bottom: `0%` }} />
                              )}
                            </div>

                            {/* Tooltip */}
                            {isHovered && (
                              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-50 bg-white border border-slate-200 shadow-xl rounded-lg p-2 text-[10px] w-32 pointer-events-none">
                                <div className="font-semibold text-[#1E1B4B] text-center text-[10px] border-b pb-0.5 mb-1">{p.name}</div>
                                <div className="space-y-[1px]">
                                  <div className="flex justify-between items-center">
                                    <span style={{color: posColor}} className="flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-sm" style={{backgroundColor: posColor}}></span> Pos</span>
                                    <span className="font-medium tabular-nums">{posPct}%</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span style={{color: neuColor}} className="flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-sm" style={{backgroundColor: neuColor}}></span> Neu</span>
                                    <span className="font-medium tabular-nums">{neuPct}%</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span style={{color: negColor}} className="flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-sm" style={{backgroundColor: negColor}}></span> Neg</span>
                                    <span className="font-medium tabular-nums">{negPct}%</span>
                                  </div>
                                </div>
                                <div className="text-[8px] text-[#94A3B7] text-center mt-1 pt-0.5 border-t">{p.mentions} mentions</div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* X-axis baseline */}
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-slate-300"></div>
                </div>
              </div>

              {/* Counts row */}
              <div className="flex gap-2 lg:gap-3 mt-1">
                {pillarStats.map((p, idx) => {
                  const isDrilled = drillPillar === p.name;
                  return (
                    <div 
                      key={idx} 
                      onClick={() => setDrillPillar(drillPillar === p.name ? null : p.name as Pillar)}
                      className={`flex-1 text-center text-[11px] text-[#6B7280] tabular-nums cursor-pointer transition ${isDrilled ? 'ring-1 ring-[#6B46C1] rounded' : ''}`}
                    >
                      {p.mentions}
                    </div>
                  );
                })}
              </div>

              {/* 4 cards: now show full pos/neu/neg + mentions. Click drills. Smaller fonts. */}
              <div className="grid grid-cols-2 lg:flex gap-2 lg:gap-3 mt-1">
                {pillarStats.map((p, i) => {
                  const label = p.name === 'Customer Service' ? 'Customer Service' : 
                               p.name === 'Claims' ? 'Claims Journey' : 
                               p.name === 'Repair' ? 'Repair Quality' : 'Replacement Speed';
                  const isDrilled = drillPillar === p.name;
                  return (
                    <div 
                      key={i} 
                      onClick={() => setDrillPillar(drillPillar === p.name ? null : p.name as Pillar)}
                      className={`flex-1 border border-slate-200 rounded-[10px] p-2.5 lg:p-3 bg-white transition-all duration-200 hover:shadow hover:-translate-y-px cursor-pointer text-xs min-w-0 ${isDrilled ? 'ring-1 ring-[#6B46C1] border-[#6B46C1]' : ''}`}
                    >
                      <div className="font-semibold text-[#1E1B4B] text-[11px] leading-none tracking-tight">{label}</div>

                      {/* Clean grouped percentages - no confusing minus signs, proper colors and spacing */}
                      <div className="mt-1 text-[9px] leading-tight flex gap-x-1.5 text-[#1E293B]">
                        <span style={{ color: "#00BA88" }} className="font-medium">{p.positive}% pos</span>
                        <span style={{ color: "#5F6073" }} className="font-medium">{p.neutral}% neu</span>
                        <span style={{ color: "#FF0055" }} className="font-medium">{p.negative}% neg</span>
                      </div>

                      <div className="text-[9px] text-[#6B7280] mt-px tabular-nums">{p.mentions} mentions</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Retailer / Client Breakdown - kept as before for functionality, styled to match */}
          <motion.div 
            className="bg-white rounded-xl border p-5 lg:p-6 shadow-sm"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut", delay: 0.1 }}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="font-semibold tracking-tight text-base">BREAKDOWN BY RETAILER / CLIENT</div>
                <div className="text-sm text-[#64748B] mt-1">Mentions mostly come from partner retailer communities (r/Newegg, r/BestBuy, r/Rogers, etc.)</div>
              </div>
              <div className="text-xs font-medium px-2.5 py-1 rounded bg-slate-100 text-slate-500 tabular-nums whitespace-nowrap">
                Last {activeRange}
              </div>
            </div>

            {retailerStats.length === 0 ? (
              <div className="text-sm text-[#64748B] py-2">No retailer-specific data in the current filter. {isSupabaseConfigured ? 'Run ingestion (manual button) or loosen the date range.' : 'Supabase not configured (see red banner above).'} </div>
            ) : (
              <ChartContainer
                config={{
                  positive: { label: "Positive", color: GREEN },
                  neutral: { label: "Neutral", color: GRAY },
                  negative: { label: "Negative", color: RED },
                }}
                className="h-[240px] w-full"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={retailerStats.map(r => ({
                    name: r.name,
                    positive: r.positive,
                    neutral: r.neutral,
                    negative: r.negative,
                    total: r.mentions,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="positive" stackId="a" fill={GREEN} />
                    <Bar dataKey="neutral" stackId="a" fill={GRAY} />
                    <Bar dataKey="negative" stackId="a" fill={RED} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 lg:gap-4 text-sm mt-6">
              {retailerStats.map((r, i) => {
                const total = r.mentions || 1;
                const posPct = Math.round((r.positive / total) * 100);
                const neuPct = Math.round((r.neutral / total) * 100);
                const negPct = Math.round((r.negative / total) * 100);
                return (
                  <div 
                    key={i} 
                    className="border border-slate-200 rounded-xl p-3.5 lg:p-4 bg-white transition-all duration-200 hover:shadow-lg hover:-translate-y-1 hover:border-slate-300"
                  >
                    <div className="font-semibold text-sm lg:text-base truncate text-[#0F172A]" title={r.name}>{r.name}</div>
                    <div className="text-[#64748B] text-xs lg:text-sm mt-0.5 tabular-nums">{r.mentions} total</div>
                    {/* Clearer, less cramped breakdown with better spacing */}
                    <div className="mt-2 text-[10px] lg:text-xs flex gap-x-2 lg:gap-x-2.5 tabular-nums whitespace-nowrap">
                      <span style={{color: GREEN}}>{posPct}% +</span>
                      <span style={{color: GRAY}}>{neuPct}% ~</span>
                      <span style={{color: RED}}>{negPct}% -</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
          </>
          )}

          {/* COMPETITOR ANALYSIS TAB - only competitor data and visuals.
              Rendered persistently (hidden via class when not active) so Recharts ResponsiveContainer
              always has a measurable parent size and avoids width/height -1 warnings on tab switch. */}
          <div className={activeTab === 'competitor' ? 'mt-4 space-y-6' : 'hidden'}>
              {/* Main Two Column Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Comparative Performance (Grouped Bar Chart) */}
                <div className="bg-white border rounded-xl p-5">
                  <div className="font-semibold mb-1">COMPARATIVE PERFORMANCE</div>
                  <div className="text-xs text-[#64748B] mb-3">Likewize vs Asurion positive sentiment % on key pillars (Claims, Repair, Replacement, Reimbursements, Call Center) — other competitors hidden for this view.</div>
                  <div style={{ height: 420 }}>
                    {competitorMounted && asurionLikewizeRadarData.some(r => (r.Likewize + r.Asurion) > 0) ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={asurionLikewizeRadarData} barGap={8} barSize={18}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis 
                            dataKey="subject" 
                            tick={{ fontSize: 9, fontWeight: 500, fill: '#475569' }}
                            interval={0}
                            angle={-20}
                            textAnchor="end"
                            height={55}
                            tickLine={false}
                          />
                          <YAxis 
                            domain={[0, yDomainMax]} 
                            tickCount={Math.min(6, Math.max(2, Math.floor(yDomainMax / 10) + 1))}
                            tick={{ fontSize: 9, fill: '#64748b' }}
                          />
                          <Tooltip content={CustomComparisonTooltip} />
                          <Legend verticalAlign="bottom" height={28} wrapperStyle={{ fontSize: '10px' }} />
                          <Bar dataKey="Likewize" name="Likewize" fill={PURPLE} />
                          <Bar dataKey="Asurion" name="Asurion" fill="#EC4899" />
                          <Bar dataKey="Allstate" name="Allstate" fill="#3B82F6" />
                          <Bar dataKey="SquareTrade" name="SquareTrade" fill="#F59E0B" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-xs text-[#64748B] border border-dashed rounded">
                        Limited competitor data in current window.<br />Use "Sync Data Sources" + "Refresh from Database" to pull more reviews.
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Key Highlights */}
                <div>
                  <div className="font-semibold mb-3">Key Highlights</div>
                  <div className="space-y-3">
                    {/* BEST AVG RATING */}
                    <div className="bg-white border rounded-xl p-4" title="">
                      <div className="text-xs text-[#64748B] font-medium">BEST AVG RATING</div>
                      <div className="mt-1 text-lg font-semibold">
                        {bestRatingComp && bestRatingComp.avg != null ? bestRatingComp.name : 'N/A'} 
                        {bestRatingComp && bestRatingComp.avg != null ? ` - ${Math.round(bestRatingComp.avg / 100 * 5 * 10)/10} / 5` : ''}
                      </div>
                      <div className="text-xs text-[#64748B] mt-1">Based on Trustpilot/BBB reviews for device protection plans.</div>
                    </div>

                    {/* FASTEST RESOLUTION */}
                    <div className="bg-white border rounded-xl p-4" title="">
                      <div className="text-xs text-[#64748B] font-medium">FASTEST RESOLUTION</div>
                      <div className="mt-1 text-lg font-semibold">
                        {fastestResComp && fastestResComp.res != null ? fastestResComp.name : 'N/A'} 
                        {fastestResComp && fastestResComp.res != null ? ` (Replacement Pos: ${fastestResComp.res}%)` : ''}
                      </div>
                      <div className="text-xs text-[#64748B] mt-1">Proxy from positive sentiment on Replacement pillar in electronic protection mentions.</div>
                    </div>

                    {/* SENTIMENT GAP TO LEADER */}
                    <div className="bg-white border rounded-xl p-4" title="">
                      <div className="text-xs text-[#64748B] font-medium">SENTIMENT GAP TO LEADER</div>
                      <div className="mt-1 text-lg font-semibold">
                        Likewize {sentGap >= 0 ? 'leads' : 'trails'} by {Math.abs(sentGap)}% 
                        {sentGap < 0 ? ' (behind leader)' : ''}
                      </div>
                      <div className="text-xs text-[#64748B] mt-1">Positive sentiment % gap vs the top competitor in current time window.</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Note: Duplicate radar removed. Single radar kept above for cleaner view when data is sparse. */}

              {/* Support Team Responsiveness — Asurion (Asurion_Sam) vs Likewize only (other competitors removed for this metric) */}
              <div className="bg-white border rounded-xl p-5">
                <div className="font-semibold mb-1">OFFICIAL SUPPORT RESPONSIVENESS</div>
                <div className="text-xs text-[#64748B] mb-3">Reddit threads only. Asurion counts replies from u/Asurion_Sam only. Likewize has no known official Reddit account — post text mentioning the brand does not count as a reply.</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border rounded-xl p-4 bg-white">
                    <div className="font-medium tracking-tight text-[#1E293B]">Likewize</div>
                    <div className="text-[10px] text-[#94A3B8] mb-1">No official Reddit account known</div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-3xl font-semibold tabular-nums">{likewizeSupport.responseRate}</span>
                      <span className="text-sm text-[#64748B]">% with official reply</span>
                    </div>
                    <div className="text-xs text-[#64748B] mt-1">{likewizeSupport.officialReplies} of {likewizeSupport.totalThreads} Reddit threads</div>
                    {likewizeSupport.avgReplyHours !== null && (
                      <div className="text-xs mt-2">Avg first reply time: <span className="font-medium">{likewizeSupport.avgReplyHours} hours</span></div>
                    )}
                  </div>

                  <div className="border rounded-xl p-4 bg-white">
                    <div className="font-medium tracking-tight text-[#1E293B]">Asurion (via Asurion_Sam)</div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-3xl font-semibold tabular-nums">{asurionSupport.responseRate}</span>
                      <span className="text-sm text-[#64748B]">% with Asurion_Sam reply</span>
                    </div>
                    <div className="text-xs text-[#64748B] mt-1">{asurionSupport.officialReplies} of {asurionSupport.totalThreads} Reddit threads</div>
                    {asurionSupport.avgReplyHours !== null && (
                      <div className="text-xs mt-2">Avg first reply time: <span className="font-medium">{asurionSupport.avgReplyHours} hours</span></div>
                    )}
                  </div>
                </div>
                <div className="text-[10px] text-[#64748B] mt-3">Only Likewize and Asurion are compared for official support metrics (per current request).</div>
              </div>

              {/* Pillar-wise Competitor Breakdown - focus on key pillars */}
              <div className="bg-white border rounded-xl p-5">
                <div className="font-semibold mb-3">Pillar Breakdown — Claims • Repair • Replacement • Reimbursements • Call Center</div>
                <div className="text-xs text-[#64748B] mb-3">Positive sentiment % by pillar (Likewize vs Asurion only — other competitors removed).</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b text-[#64748B] text-xs">
                        <th className="py-2">Pillar</th>
                        <th className="py-2">Likewize</th>
                        <th className="py-2">Asurion</th>
                        <th className="py-2 text-right">Leader</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {pillarBreakdownByCompetitor.map((p, i) => (
                        <tr key={i}>
                          <td className="py-1.5 font-medium">{p.pillar}</td>
                          <td>{p.likewize}% ({p.likewizeCount})</td>
                          <td>{p.asurion}% ({p.asurionCount})</td>
                          <td className="text-xs text-right text-[#64748B]">{p.asurion > p.likewize ? 'Asurion' : p.likewize > p.asurion ? 'Likewize' : 'Tie'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* COMPETITIVE MATRIX (clean, no NPS/Retention columns) */}
              <div className="bg-white border rounded-xl p-5">
                <div className="font-semibold mb-3">COMPETITIVE MATRIX</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b text-[#64748B] text-xs">
                        <th className="py-2 pr-4">BRAND</th>
                        <th className="py-2 pr-4">AVG RATING</th>
                        <th className="py-2 pr-4">RESOLUTION (Score)</th>
                        <th className="py-2 pr-4">SENTIMENT</th>
                        <th className="py-2 pr-4">RECOVERY %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {comps.map((c, i) => {
                        const brandColor = c.name === 'Likewize' ? PURPLE : '#EC4899';
                        const resScore = c.res != null ? c.res : '—';
                        const sentVal = c.sent != null ? `${c.sent}%` : '—';
                        const brandMentions = c.name === 'Likewize' ? likewizeMentions : asurionMentions;
                        const recovery = computeRecoveryRate(brandMentions);
                        return (
                          <tr key={i}>
                            <td className="py-2 pr-4 font-medium" style={{color: brandColor}}>{c.name}</td>
                            <td className="py-2 pr-4">{c.avg != null ? Math.round(c.avg / 100 * 5 * 10)/10 : '—'} / 5</td>
                            <td className="py-2 pr-4">{resScore}{resScore !== '—' ? '%' : ''} <span className="text-[10px] text-gray-400">(higher = faster proxy)</span></td>
                            <td className="py-2 pr-4">{sentVal}</td>
                            <td className="py-2 pr-4">{recovery}% <span className="text-[10px] text-gray-400">(neg + positive reply)</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="text-[10px] text-[#64748B] mt-2">Resolution = positive % on Replacement pillar. Recovery = negatives with supportive reply in thread (new retention proxy).</div>
              </div>

              {/* Competitor Recent Mentions */}
              <div className="bg-white border rounded-xl p-5">
                <div className="font-semibold mb-3">Recent Competitor Mentions (Asurion / SquareTrade)</div>
                {competitorMentions.length === 0 ? (
                  <div className="text-sm text-[#64748B]">No competitor data yet. Click "Sync Data Sources" to pull fresh reviews.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    {competitorMentions
                      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                      .slice(0, 8)
                      .map((m, idx) => (
                        <div key={idx} onClick={() => setSelectedInsight(m)} className="border rounded p-3 hover:bg-gray-50 cursor-pointer">
                          <div className="flex justify-between text-xs text-[#64748B]">
                            <span className="font-medium">{m.company} • {formatMentionSourceLabel(m.source)}</span>
                            <span>{new Date(m.created_at).toLocaleDateString()}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-[#0F172A]">{m.text}</p>
                          <div className="mt-1 text-[10px]" style={{ color: m.sentiment === 'positive' ? GREEN : m.sentiment === 'negative' ? RED : GRAY }}>
                            {m.sentiment} · {m.pillar} {m.rating != null ? `· ${m.rating}★` : ''}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <div className="text-xs text-[#64748B]">
                All data shown here is strictly filtered to <strong>electronic device protection</strong> (phones, gadgets, electronics plans). Non-relevant categories are excluded at query, scrape, filter, and classification time.
              </div>
            </div>
        </div>
      </div>

      {/* Right Sidebar - Recent Insights - sized to match retailer breakdown width (not too wide) */}
      <div className="w-full lg:w-64 xl:w-72 flex-shrink-0 border-t lg:border-t-0 lg:border-l bg-white p-3 lg:p-4 overflow-auto">
        <div className="font-semibold mb-3 text-base flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full" />
            {activeTab === 'competitor' ? 'Competitor Insights' : 'Recent Insights'}
          </div>
          <Button size="sm" variant="outline" onClick={() => handleIngestAll(false)} disabled={isIngesting} title="Start background data sync (then use Refresh from Database)">
            <RefreshCw className={`h-3 w-3 mr-1 ${isIngesting ? 'animate-spin' : ''}`} /> Sync
          </Button>
        </div>
        <div className="space-y-4 text-sm">
          { (activeTab === 'competitor' ? competitorMentions : recentInsights).length === 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 text-[#64748B] text-xs shadow-sm">
              No data in current filter.<br />
              {isSupabaseConfigured
                ? 'Data is populated by the background cron job (or the "Sync Data Sources" button).'
                : 'Supabase keys are placeholders in .env.local — fix and restart.'}
            </div>
          )}
          {(activeTab === 'competitor' ? competitorMentions : recentInsights)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 7)
            .map((m) => {
              const sentimentColor = m.sentiment === 'positive' ? GREEN : m.sentiment === 'negative' ? RED : GRAY;
              const isComp = !!m.company && m.company !== 'Likewize';

              // Source branding with colors from Lovable reference
              const src = (m.source || '').toLowerCase();
              const sourceLabel = formatMentionSourceLabel(m.source);
              let sourceColor = GRAY;
              if (src.includes('reddit')) {
                sourceColor = PURPLE;
              } else if (src.includes('trustpilot')) {
                sourceColor = '#14B8A6'; // Teal
              } else if (src.includes('pissedconsumer') || src.includes('pissed')) {
                sourceColor = '#EF4444'; // Red for consumer complaint sites
              } else if (src.includes('app') || src.includes('apple') || src.includes('store')) {
                sourceColor = PINK;
              } else if (src.includes('bbb')) {
                sourceColor = '#3B82F6';
              }

              // Handle (subreddit or client)
              const handle = m.subreddit ? `r/${m.subreddit}` : m.client || (isComp ? m.company : '');

              const timeAgo = formatMentionTimeAgo(m.created_at);

              return (
                <div
                  key={mentionDedupKey(m)}
                  onClick={() => setSelectedInsight(m)}
                  className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 group"
                  title="Click for full review / thread + details"
                >
                  {/* Top row: Source + time */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold tracking-wide" style={{ color: sourceColor }}>{sourceLabel}</span>
                    <span className="text-[#64748B] tabular-nums">{timeAgo}</span>
                  </div>

                  {/* Handle / subreddit */}
                  {handle && (
                    <div className="text-[11px] text-[#64748B] mt-0.5 truncate group-hover:text-[#475569] transition-colors">
                      {handle}
                    </div>
                  )}

                  {/* Main text */}
                  <p className="mt-2 text-sm leading-snug text-[#0F172A] line-clamp-3">
                    {m.text}
                  </p>

                  {/* Bottom right sentiment pill - Lovable style with soft backgrounds */}
                  <div className="mt-3 flex justify-end">
                    <div
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium ${
                        m.sentiment === 'positive' ? 'bg-[#DCFCE7] text-[#166534]' : 
                        m.sentiment === 'negative' ? 'bg-[#FEE2E2] text-[#991B1B]' : 
                        'bg-[#F1F5F9] text-[#475569]'
                      }`}
                    >
                      {m.sentiment}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Clickable Full Insight Side Panel / Modal (full thread text, client, source, date, tags, link) */}
      {selectedInsight && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex" onClick={() => setSelectedInsight(null)}>
          <div className="ml-auto w-full max-w-lg bg-white h-full overflow-auto shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-xs uppercase tracking-widest text-[#64748B]">Full Review / Thread</div>
                <div className="text-xl font-semibold mt-1">
                  {formatMentionSourceLabel(selectedInsight.source)}{selectedInsight.client ? ` • ${selectedInsight.client}` : ''}
                </div>
              </div>
              <button onClick={() => setSelectedInsight(null)} className="text-2xl leading-none text-[#64748B] hover:text-black">×</button>
            </div>

            <div className="flex items-center gap-2 text-sm mb-4">
              <span className="text-[#64748B]">{new Date(selectedInsight.created_at).toLocaleString()}</span>
              <span
                className="px-2 py-0.5 rounded text-xs font-medium"
                style={{
                  backgroundColor: `${selectedInsight.sentiment === 'positive' ? GREEN : selectedInsight.sentiment === 'negative' ? RED : GRAY}20`,
                  color: selectedInsight.sentiment === 'positive' ? GREEN : selectedInsight.sentiment === 'negative' ? RED : GRAY,
                }}
              >
                {selectedInsight.sentiment} · {selectedInsight.pillar}
              </span>
              {selectedInsight.rating != null && (
                <span className="text-xs px-1.5 py-0.5 bg-gray-100 rounded">{selectedInsight.rating}★</span>
              )}
            </div>

            {selectedInsight.title && (
              <div className="font-medium mb-2 text-[#0F172A]">{selectedInsight.title}</div>
            )}

            <div className="prose prose-sm max-w-none whitespace-pre-wrap text-[#0F172A] bg-[#F8FAFC] p-4 rounded border">
              {selectedInsight.text}
            </div>

            {selectedInsight.key_issue && (
              <div className="mt-4 text-sm">
                <span className="font-medium text-[#64748B]">Key issue:</span> {selectedInsight.key_issue}
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <Button
                onClick={() => window.open(selectedInsight.url, '_blank')}
                style={{ backgroundColor: PURPLE }}
                className="text-white"
              >
                Open original source
              </Button>
              <Button variant="outline" onClick={() => setSelectedInsight(null)}>
                Close
              </Button>
            </div>

            <div className="mt-8 text-[10px] text-[#64748B]">
              ID: {selectedInsight.id} • Confidence: {((selectedInsight.confidence || 0.8) * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
