"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Star, RefreshCw, Download, LayoutDashboard, Users, Activity, Bell } from "lucide-react";
import { motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { HealthGauge } from "@/components/dashboard/HealthGauge";
import type { ClassifiedMention, Pillar } from "@/lib/classify";
import { supabase } from "@/lib/supabase";
import {
  isLikewizeRelevant,
  isElectronicDeviceProtection,
  detectCompany,
  normalizeMentionSource,
  formatMentionSourceLabel,
  dedupeMentions,
  formatMentionTimeAgo,
  mentionDedupKey,
  isDashboardSource,
  getMentionClient,
  detectBusinessLine,
  formatBusinessLine,
  BUSINESS_LINE_LABELS,
  type BusinessLine,
} from "@/lib/utils";
import { detectOfficialSupportReply, isRedditMention } from "@/lib/officialSupport";
import {
  getInsightHighlightReasons,
  segmentHighlightedText,
  type HighlightReason,
} from "@/lib/highlightReasons";
import { ThreadFeedback } from "@/components/ThreadFeedback";
import { UserMenu } from "@/components/UserMenu";
import { DashboardSearch, mentionMatchesSource } from "@/components/DashboardSearch";
import { AlertEnrollment } from "@/components/AlertEnrollment";
import { aggregateIssueThemes, type AggregatedTheme } from "@/lib/issueThemes";
import { toast } from "sonner";

// Detect obvious misconfiguration so we can show a clear banner instead of silent empty + scary console errors
const isSupabaseConfigured = !!supabase;
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, PieChart, Pie } from "recharts";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";

// Brand palette from protect.likewize.com (theme main.css)
const PURPLE = "#3200BE";
const PINK = "#FF96FF";
// Positive sentiment / "good" segments use brand pink
const GREEN = "#FF96FF";
const GRAY = "#5C5470";
const RED = "#E11D48";
const CYAN = "#00A8B8";
const BG = "#F7F5FC";
const TEXT = "#1A0B3D";
const BORDER = "#E8E2F4";
const CARD_SHADOW = "0 1px 2px rgba(50,0,190,0.04), 0 4px 14px rgba(50,0,190,0.06)";

const timeRanges = ["7d", "30d", "90d", "All"] as const;

/**
 * External callout label + leader line.
 * Always stays OUTSIDE the pie ring, then nudged to stay inside the plot box.
 */
function PieCalloutLabel(props: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  name?: string;
  value?: number;
  percent?: number;
  fill?: string;
  /** "paren" → Name (n)  ·  "dot" → Name · n */
  style?: "paren" | "dot";
}) {
  const {
    cx = 0,
    cy = 0,
    midAngle = 0,
    outerRadius = 0,
    name = "",
    value = 0,
    percent = 0,
    fill = PURPLE,
    style = "paren",
  } = props;
  if (!value || percent < 0.015) return null;

  const RADIAN = Math.PI / 180;
  const sin = Math.sin(-midAngle * RADIAN);
  const cos = Math.cos(-midAngle * RADIAN);
  const plotW = Math.max(cx * 2, 1);
  const plotH = Math.max(cy * 2, 1);
  const edge = 8;
  // Never place text closer to center than this (outside the ring)
  const minOutside = outerRadius + 18;

  const label =
    style === "dot"
      ? `${name} · ${value.toLocaleString()}`
      : `${name} (${value.toLocaleString()})`;
  const estW = Math.min(label.length * 6.1, plotW * 0.45);
  const textAnchor: "start" | "end" = cos >= 0 ? "start" : "end";

  // 1) Ideal elbow on the ray, outside the pie
  const sx = cx + (outerRadius + 3) * cos;
  const sy = cy + (outerRadius + 3) * sin;
  let mx = cx + (outerRadius + 16) * cos;
  let my = cy + (outerRadius + 16) * sin;

  // 2) Horizontal stub toward label side
  let ex = mx + (cos >= 0 ? 1 : -1) * 10;
  let ey = my;

  // 3) Text position just past the stub
  let textX = ex + (cos >= 0 ? 5 : -5);
  let textY = ey;

  // 4) Keep text fully inside plot horizontally
  if (textAnchor === "start") {
    if (textX + estW > plotW - edge) {
      textX = plotW - edge - estW;
    }
    if (textX < edge) textX = edge;
  } else {
    if (textX - estW < edge) {
      textX = edge + estW;
    }
    if (textX > plotW - edge) textX = plotW - edge;
  }

  // 5) Vertical clamp inside plot
  textY = Math.min(Math.max(textY, edge + 10), plotH - edge - 10);

  // 6) CRITICAL: if clamping dragged the label into the pie, push it back out along the ray
  const pushOutside = (x: number, y: number) => {
    let dx = x - cx;
    let dy = y - cy;
    let dist = Math.hypot(dx, dy);
    if (dist < 0.001) {
      dx = cos;
      dy = sin;
      dist = 1;
    }
    if (dist < minOutside) {
      const s = minOutside / dist;
      return { x: cx + dx * s, y: cy + dy * s };
    }
    return { x, y };
  };

  ({ x: textX, y: textY } = pushOutside(textX, textY));
  // Re-clamp Y after push (X may need slight room)
  textY = Math.min(Math.max(textY, edge + 10), plotH - edge - 10);
  if (textAnchor === "start") {
    textX = Math.min(textX, plotW - edge - estW * 0.15);
    textX = Math.max(textX, Math.min(cx + minOutside * 0.35, plotW - edge - 4));
  } else {
    textX = Math.max(textX, edge + estW * 0.15);
    textX = Math.min(textX, Math.max(cx - minOutside * 0.35, edge + 4));
  }
  ({ x: textX, y: textY } = pushOutside(textX, textY));

  // Elbow ends near the text, still outside the pie
  ex = textX + (textAnchor === "start" ? -5 : 5);
  ey = textY;
  ({ x: ex, y: ey } = pushOutside(ex, ey));
  // Mid control point between pie surface and elbow
  mx = (sx + ex) / 2;
  my = (sy + ey) / 2;
  const midOut = pushOutside(mx, my);
  mx = midOut.x;
  my = midOut.y;

  return (
    <g style={{ pointerEvents: "none" }}>
      <path
        d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`}
        stroke={fill}
        fill="none"
        strokeWidth={1.25}
      />
      <circle cx={ex} cy={ey} r={2.25} fill={fill} />
      <text
        x={textX}
        y={textY}
        textAnchor={textAnchor}
        dominantBaseline="central"
        fill={fill}
        fontSize={11}
        fontWeight={600}
        style={{ fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}
      >
        {label}
      </text>
    </g>
  );
}

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
  /** Client / account filter — "All" = no filter. Values match getMentionClient(). */
  const [activeClient, setActiveClient] = useState<string>("All");
  /** Source filter — "All" | Reddit | PissedConsumer | BBB | … */
  const [activeSource, setActiveSource] = useState<string>("All");
  /** Competitor client menu: top 10, then expand list in-place via Show more */
  const [showAllClients, setShowAllClients] = useState(false);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const clientMenuRef = useRef<HTMLDivElement>(null);
  /** Likewize business line filter (Overview only): All | DP | HomeTech | TradeIn | Other */
  const [activeBusinessLine, setActiveBusinessLine] = useState<'All' | BusinessLine>("All");
  const [mentions, setMentions] = useState<ClassifiedMention[]>([]);
  /** True after first Supabase load finishes (success or empty) — used by alert screenshots */
  const [dataReady, setDataReady] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [lastIngestInfo, setLastIngestInfo] = useState<{reddit?: number; pissedconsumer?: number; bbb?: number} | null>(null);
  const [dbLoadMeta, setDbLoadMeta] = useState<{ raw: number; shown: number } | null>(null);
  const [selectedInsight, setSelectedInsight] = useState<ClassifiedMention | null>(null);

  // Tab navigation: Overview + Competitor Analysis
  const [activeTab, setActiveTab] = useState<'overview' | 'competitor'>('overview');
  // Used to mount Recharts ResponsiveContainers only on client + when tab active
  const [competitorMounted, setCompetitorMounted] = useState(false);

  // Drill down on pillar breakdown
  const [drillPillar, setDrillPillar] = useState<Pillar | null>(null);
  const [hoveredPillar, setHoveredPillar] = useState<Pillar | null>(null);
  /** Panel: Reddit threads where u/Asurion_Sam replied */
  const [showAsurionSamThreads, setShowAsurionSamThreads] = useState(false);
  /** Panel: threads for a selected pain/love theme */
  const [themeDrill, setThemeDrill] = useState<AggregatedTheme | null>(null);
  /** Email alert enrollment modal */
  const [alertEnrollOpen, setAlertEnrollOpen] = useState(false);

  // Keep Recent Insights rail the exact same height as the main dashboard column (desktop)
  const dashboardColRef = useRef<HTMLDivElement>(null);
  const [insightsHeight, setInsightsHeight] = useState<number | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onMq = () => setIsDesktop(mq.matches);
    onMq();
    mq.addEventListener('change', onMq);
    return () => mq.removeEventListener('change', onMq);
  }, []);
  useEffect(() => {
    const el = dashboardColRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      // offsetHeight includes padding + border; ceil so we never fall short by a px
      const h = Math.ceil(el.offsetHeight);
      if (h > 0) setInsightsHeight(h);
    };
    update();
    // Re-measure after layout/paint (charts, fonts) settle
    const raf = requestAnimationFrame(() => requestAnimationFrame(update));
    const t = window.setTimeout(update, 120);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      ro.disconnect();
    };
  }, [activeTab, activeRange, activeClient, activeBusinessLine, mentions.length, isDesktop]);

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
        const sourceNorm = normalizeMentionSource(raw.source || row.source, {
          url: row.url,
          id: raw.reddit_id || row.reddit_id,
        });
        // Resolve company carefully so Asurion never lands on the Likewize overview
        let company = (row.company || row.competitor || raw.company || raw.competitor || '') as ClassifiedMention['company'];
        const rowId = String(row.reddit_id || raw.reddit_id || row.id || '');
        // BBB profile ids encode brand: Likewize 0825_1000202069_* · Asurion 0573_2131781_*
        if (rowId.includes('2131781') || rowId.includes('0573_2131781')) {
          company = 'Asurion';
        } else if (rowId.includes('1000202069') || rowId.includes('0825_1000202069')) {
          company = 'Likewize';
        }
        if (!company || company === 'Other') {
          company = detectCompany(hay) as ClassifiedMention['company'];
        }
        // PissedConsumer listings for Likewize brand page
        if ((!company || company === 'Other') && sourceNorm.includes('pissed')) {
          company = 'Likewize';
        }
        if (!company) company = 'Other';

        const productType = (row.product_type || raw.product_type || 'electronic_device_protection') as any;
        const retailerContext = row.retailer || raw.retailer_context || raw.client || row.subreddit || raw.subreddit;
        // Normalize client/account once at load so filters + charts use stable labels
        const clientLabel = getMentionClient({
          client: retailerContext,
          retailer_context: retailerContext,
          subreddit: row.subreddit || raw.subreddit,
          source: sourceNorm,
        });

        const fullThread = raw.full_thread || raw.original?.full_thread || '';
        const textBody = row.content || row.text || '';
        const business_line = detectBusinessLine({
          client: clientLabel,
          retailer_context: clientLabel,
          subreddit: row.subreddit || raw.subreddit,
          source: sourceNorm,
          text: textBody,
          title: row.title,
          full_thread: fullThread,
          content: textBody,
        });

        const mention = {
          id: row.id || raw.reddit_id || `db-${Date.now()}`,
          text: textBody,
          source: sourceNorm,
          url: row.url || '',
          created_at: row.created_at,
          sentiment: row.sentiment,
          pillar: row.pillar,
          confidence: row.confidence,
          key_issue: undefined,
          client: clientLabel,
          subreddit: row.subreddit || raw.subreddit,
          title: row.title,
          rating: raw.rating ?? row.rating,
          company,
          product_type: productType,
          is_relevant: raw.product_type !== 'other',
          retailer_context: clientLabel,
          full_thread: fullThread,
          comments: (raw.comments || raw.original?.comments || []) as any[],
          has_official_reply: false,
          first_official_reply_hours: null,
          official_replier: null,
          business_line,
        } as ClassifiedMention;

        if (isRedditMention(mention.source) && (company === 'Asurion' || company === 'Likewize')) {
          const comments = [
            ...(mention.comments || []),
            ...((raw.comments || []) as any[]),
            ...((raw.original?.comments || []) as any[]),
          ];
          const support = detectOfficialSupportReply({
            company,
            comments,
            full_thread: mention.full_thread || raw.full_thread,
            created_at: mention.created_at,
          });
          // Prefer live detection; fall back to trusted stored Asurion_Sam flags from Sam index backfill
          if (support.has_official_reply) {
            mention.has_official_reply = true;
            mention.first_official_reply_hours = support.first_official_reply_hours;
            mention.official_replier = support.official_replier;
          } else if (
            raw.has_official_reply &&
            /asurion[_-]?sam/i.test(String(raw.official_replier || ''))
          ) {
            mention.has_official_reply = true;
            mention.first_official_reply_hours = raw.first_official_reply_hours ?? null;
            mention.official_replier = raw.official_replier ?? 'Asurion_Sam';
          } else {
            mention.has_official_reply = false;
            mention.first_official_reply_hours = null;
            mention.official_replier = null;
          }
          mention.comments = comments;
        } else if (raw.has_official_reply && !['likewize', 'asurion'].includes(String(raw.official_replier || '').toLowerCase())) {
          mention.has_official_reply = raw.has_official_reply;
          mention.first_official_reply_hours = raw.first_official_reply_hours ?? null;
          mention.official_replier = raw.official_replier ?? null;
        }

        return mention;
      });

      // Dashboard: Reddit + PissedConsumer + BBB (Likewize overview + Asurion competitor)
      const sourceOnly = normalized.filter((m) => isDashboardSource(m.source));

      if (sourceOnly.length !== normalized.length) {
        console.log(`[loadFromSupabase] Source filter (Reddit + PC + BBB): ${sourceOnly.length}/${normalized.length}`);
      }
      const deduped = dedupeMentions(sourceOnly);
      setDbLoadMeta({ raw: normalized.length, shown: deduped.length });
      console.log(`[loadFromSupabase] Loaded ${deduped.length} records (${normalized.length} raw rows in DB).`);
      return deduped;
    } catch {
      return [];
    }
  }

  // Deep-link filters for alert screenshots / shared URLs: ?client=&line=&source=&tab=&range=
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const client = params.get('client');
    const line = params.get('line');
    const source = params.get('source');
    const tab = params.get('tab');
    const range = params.get('range');
    if (client) setActiveClient(client);
    if (line && ['DP', 'HomeTech', 'TradeIn', 'Shipping', 'CallCenter', 'Other'].includes(line)) {
      setActiveBusinessLine(line as BusinessLine);
    }
    if (source) setActiveSource(source);
    if (tab === 'competitor' || tab === 'overview') setActiveTab(tab);
    if (range === '7d' || range === '30d' || range === '90d' || range === 'All') {
      setActiveRange(range);
    }
  }, []);

  // Always load existing data from Supabase immediately on mount/refresh (device protection only).
  // Overview tab focuses on Likewize; Competitor tab compares Asurion + SquareTrade.
  // No auto heavy work on load.
  useEffect(() => {
    loadFromSupabase()
      .then(setMentions)
      .finally(() => setDataReady(true));
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

  function filterByClient(data: ClassifiedMention[], client: string): ClassifiedMention[] {
    if (!client || client === 'All') return data;
    return data.filter((m) => getMentionClient(m as any) === client);
  }

  function filterBySource(data: ClassifiedMention[], source: string): ClassifiedMention[] {
    if (!source || source === 'All') return data;
    return data.filter((m) => mentionMatchesSource(m, source));
  }

  /** Strict Likewize gate for the main Overview page. Never include Asurion/Allstate/etc. */
  function isLikewizeOnlyMention(m: ClassifiedMention): boolean {
    const company = (m.company || '').trim();
    // Explicit competitor tags always stay off the main page
    if (company === 'Asurion' || company === 'Allstate' || company === 'SquareTrade') return false;
    if (company === 'Likewize') return true;
    // PissedConsumer on this product is always Likewize
    const src = (m.source || '').toLowerCase();
    if (src.includes('pissed')) return true;
    // Fallback: body must clearly mention Likewize (not just device protection)
    return isLikewizeRelevant(m as any);
  }

  // Pool used for the Client dropdown counts — Overview = Likewize only; Competitor = full set
  const clientFilterPool = useMemo(() => {
    const timed = filterByDateRange(currentMentions, activeRange);
    if (activeTab === 'overview') {
      return timed.filter(isLikewizeOnlyMention);
    }
    return timed;
  }, [currentMentions, activeRange, activeTab]);

  // Available clients/accounts for the filter dropdown (scoped to current tab + time range)
  const clientOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of clientFilterPool) {
      const key = getMentionClient(m as any);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [clientFilterPool]);

  const CLIENT_DROPDOWN_TOP_N = 10;
  /**
   * Overview: full client list (no Show more).
   * Competitor: top 10 unless expanded; always keep active selection in the list.
   */
  const visibleClientOptions = useMemo(() => {
    if (activeTab !== 'competitor') return clientOptions;
    if (showAllClients || clientOptions.length <= CLIENT_DROPDOWN_TOP_N) {
      return clientOptions;
    }
    const top = clientOptions.slice(0, CLIENT_DROPDOWN_TOP_N);
    if (activeClient !== 'All' && !top.some((c) => c.name === activeClient)) {
      const selected = clientOptions.find((c) => c.name === activeClient);
      if (selected) return [...top, selected];
    }
    return top;
  }, [clientOptions, showAllClients, activeClient, activeTab]);

  const hiddenClientCount =
    activeTab === 'competitor' ? Math.max(0, clientOptions.length - CLIENT_DROPDOWN_TOP_N) : 0;
  const showClientMoreOption =
    activeTab === 'competitor' && clientOptions.length > CLIENT_DROPDOWN_TOP_N;

  const clientDropdownTotal = clientFilterPool.length;

  // Collapse expanded client list / close menu when leaving Competitor
  useEffect(() => {
    if (activeTab !== 'competitor') {
      setShowAllClients(false);
      setClientMenuOpen(false);
    }
  }, [activeTab]);

  // Close client menu on outside click / Escape
  useEffect(() => {
    if (!clientMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (clientMenuRef.current && !clientMenuRef.current.contains(e.target as Node)) {
        setClientMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setClientMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [clientMenuOpen]);

  // If the selected client disappears after a refresh, reset to All
  useEffect(() => {
    if (activeClient === 'All') return;
    if (!clientOptions.some((c) => c.name === activeClient)) {
      setActiveClient('All');
    }
  }, [clientOptions, activeClient]);

  const timeFiltered = filterByDateRange(currentMentions, activeRange);

  // Global dashboard filter: time window + client + source. Everything below uses this.
  const filteredMentions = useMemo(() => {
    let d = filterByClient(timeFiltered, activeClient);
    d = filterBySource(d, activeSource);
    return d;
  }, [timeFiltered, activeClient, activeSource]);

  // Search index: date-filtered only (not client/source) so you can jump to other dimensions
  const searchPool = timeFiltered;
  const ecosystemTotal = filteredMentions.length; // full pool (all companies) — competitor tab only

  // Overview tab = Likewize ONLY (health, pillars, insights, retailers, source mix, TOTAL MENTIONS).
  // Optional business-line filter (DP / HomeTech / TradeIn / Other) — Overview only.
  const overviewMentions = useMemo(() => {
    let base = filteredMentions.filter(isLikewizeOnlyMention);
    if (activeBusinessLine !== 'All') {
      base = base.filter((m) => (m.business_line || detectBusinessLine(m as any)) === activeBusinessLine);
    }
    if (drillPillar) {
      base = base.filter(m => m.pillar === drillPillar);
    }
    return base;
  }, [filteredMentions, drillPillar, activeBusinessLine]);

  // Likewize pool before business-line filter (for distribution chart + filter option counts)
  const likewizePoolForBizLine = useMemo(() => {
    return filteredMentions.filter(isLikewizeOnlyMention);
  }, [filteredMentions]);

  const businessLineDistribution = useMemo(() => {
    // Brand pink / blue family only (protect.likewize.com)
    const colors: Record<BusinessLine, string> = {
      DP: '#3200BE',       // deep brand blue
      HomeTech: '#00A8B8', // cyan
      TradeIn: '#FF96FF',  // brand pink
      Shipping: '#6B5CE7', // soft indigo
      CallCenter: '#E879F9', // light pink
      Other: '#A78BFA',    // lavender
    };
    const counts: Record<BusinessLine, number> = {
      DP: 0,
      HomeTech: 0,
      TradeIn: 0,
      Shipping: 0,
      CallCenter: 0,
      Other: 0,
    };
    for (const m of likewizePoolForBizLine) {
      const line = (m.business_line || detectBusinessLine(m as any)) as BusinessLine;
      if (line in counts) counts[line]++;
      else counts.Other++;
    }
    return (Object.keys(counts) as BusinessLine[]).map((line) => ({
      line,
      label: BUSINESS_LINE_LABELS[line],
      count: counts[line],
      fill: colors[line],
    }));
  }, [likewizePoolForBizLine]);

  // Source mix on main page = Likewize only (respects business-line filter)
  const sourceDistribution = useMemo(() => {
    const redditCount = overviewMentions.filter((m) => (m.source || '').toLowerCase().includes('reddit')).length;
    const pcCount = overviewMentions.filter((m) => (m.source || '').toLowerCase().includes('pissed')).length;
    const bbbCount = overviewMentions.filter((m) => {
      const s = (m.source || '').toLowerCase();
      const id = (m.id || '').toLowerCase();
      return s.includes('bbb') || id.startsWith('bbb-');
    }).length;
    // Brand pink / blue only (no red)
    return [
      { source: 'Reddit', count: redditCount, fill: PURPLE },
      { source: 'PissedConsumer', count: pcCount, fill: PINK },
      { source: 'BBB', count: bbbCount, fill: '#A78BFA' },
    ];
  }, [overviewMentions]);

  // Concrete issue themes (portal, replacement quality, repair service, …) — Overview, respects filters
  const topPainPoints = useMemo(
    () => aggregateIssueThemes(overviewMentions, 'pain', 6),
    [overviewMentions],
  );
  const topLoveDrivers = useMemo(
    () => aggregateIssueThemes(overviewMentions, 'love', 6),
    [overviewMentions],
  );

  const hasData = overviewMentions.length > 0;
  const likewizeTotal = overviewMentions.length;
  // MAIN PAGE TOTAL — always Likewize count, never ecosystemTotal
  const total = overviewMentions.length;
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

  // Retailer / Client breakdown (partner channels only — never brand labels like Likewize/Unassigned)
  const retailerStats: RetailerStat[] = useMemo(() => {
    const skip = new Set(['likewize', 'unassigned', 'asurion', 'allstate', 'squaretrade', 'other', 'other/direct']);
    const groups = new Map<string, ClassifiedMention[]>();
    overviewMentions.forEach(m => {
      const key = getMentionClient(m as any);
      if (skip.has(key.toLowerCase())) return;
      // BBB / direct brand channels are not retailers
      const src = (m.source || '').toLowerCase();
      if (src.includes('bbb') || String(m.id || '').startsWith('bbb-')) return;
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
  // COMPETITOR DATA (for Competitor Analysis tab) - respects time + client filters
  // IMPORTANT: All of this is derived from the `mentions` state, which is *always*
  // populated exclusively via loadFromSupabase() (initial mount + after every ingest).
  // Ingest first pushes to Supabase (via supabaseAdmin.upsert in runIngestion), then we reload.
  // Same source of truth as the Overview tab. No direct use of ingest "incoming" data for UI.
  // =====================================================
  const timeFilteredCompetitorBase = filteredMentions; // time + client filtered

  // Competitor filters: prefer explicit company tag (from classification or raw_data).
  // Fallback to text match so that data loaded from Supabase (even old rows or rows where
  // classification only set sentiment/pillar) still appears for Asurion/Allstate etc.
  // This fixes "competitor tab isnt loading the data at all".
  const textContains = (m: any, re: RegExp) => re.test(`${m.text || ''} ${m.title || ''} ${(m as any).full_thread || ''}`.toLowerCase());

  const likewizeMentions = timeFilteredCompetitorBase.filter(m => 
    m.company === 'Likewize' || (!m.company && isLikewizeRelevant(m as any))
  );
  const asurionMentions = timeFilteredCompetitorBase.filter(m => {
    const id = String(m.id || '').toLowerCase();
    return (
      m.company === 'Asurion' ||
      id.includes('2131781') ||
      (!m.company && textContains(m, /asurion/))
    );
  });

  // Competitor tab source mix for Asurion (Reddit + BBB) — Overview uses its own source chart
  const asurionSourceMix = useMemo(() => {
    const reddit = asurionMentions.filter((m) => (m.source || '').toLowerCase().includes('reddit')).length;
    const bbb = asurionMentions.filter((m) => {
      const s = (m.source || '').toLowerCase();
      const id = String(m.id || '').toLowerCase();
      return s.includes('bbb') || id.startsWith('bbb-');
    }).length;
    const other = Math.max(0, asurionMentions.length - reddit - bbb);
    return [
      { source: 'Reddit', count: reddit, fill: PURPLE },
      { source: 'BBB', count: bbb, fill: '#A78BFA' },
      ...(other > 0 ? [{ source: 'Other', count: other, fill: '#C4B5FD' }] : []),
    ];
  }, [asurionMentions]);

  const likewizeCompetitorSourceMix = useMemo(() => {
    const reddit = likewizeMentions.filter((m) => (m.source || '').toLowerCase().includes('reddit')).length;
    const bbb = likewizeMentions.filter((m) => {
      const s = (m.source || '').toLowerCase();
      const id = String(m.id || '').toLowerCase();
      return s.includes('bbb') || id.startsWith('bbb-');
    }).length;
    const pc = likewizeMentions.filter((m) => (m.source || '').toLowerCase().includes('pissed')).length;
    const other = Math.max(0, likewizeMentions.length - reddit - bbb - pc);
    return [
      { source: 'Reddit', count: reddit, fill: PURPLE },
      { source: 'BBB', count: bbb, fill: '#A78BFA' },
      { source: 'PissedConsumer', count: pc, fill: PINK },
      ...(other > 0 ? [{ source: 'Other', count: other, fill: '#C4B5FD' }] : []),
    ].filter((s) => s.count > 0);
  }, [likewizeMentions]);
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

  // Competitor Insights sidebar: Asurion + Allstate only (never Likewize)
  const competitorInsights = useMemo(() => {
    const pool = [
      ...asurionMentions.map((m) => ({ ...m, company: 'Asurion' as const })),
      ...allstateMentions.map((m) => ({ ...m, company: 'Allstate' as const })),
    ];
    return dedupeMentions(pool)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 12);
  }, [asurionMentions, allstateMentions]);

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

  // Official support = Asurion_Sam (Asurion) only. Uses structured comments, full_thread,
  // and trusted stored flags from Sam-index backfill. Never treats brand name "Asurion" as a replier.
  function getSupportResponsiveness(mentions: any[], company: 'Asurion' | 'Likewize') {
    type RepliedThread = ClassifiedMention & { replyHours: number | null };
    const redditThreads = (mentions || []).filter((m) => isRedditMention(m.source));
    if (!redditThreads.length) {
      return {
        responseRate: 0,
        officialReplies: 0,
        totalThreads: 0,
        avgReplyHours: null as number | null,
        repliedThreads: [] as RepliedThread[],
      };
    }

    let replied = 0;
    const replyTimes: number[] = [];
    const repliedThreads: RepliedThread[] = [];

    redditThreads.forEach((m: any) => {
      const comments = [
        ...(m.comments || []),
        ...((m as any).raw_data?.comments || []),
        ...((m as any).raw_data?.original?.comments || []),
      ];
      const support = detectOfficialSupportReply({
        company,
        comments,
        full_thread: m.full_thread || (m as any).raw_data?.full_thread,
        created_at: m.created_at,
      });

      const storedSam =
        company === 'Asurion' &&
        m.has_official_reply &&
        /asurion[_-]?sam/i.test(String(m.official_replier || ''));

      if (support.has_official_reply || storedSam) {
        replied++;
        const hours =
          support.first_official_reply_hours ??
          (typeof m.first_official_reply_hours === 'number' ? m.first_official_reply_hours : null);
        // Exclude absurd outliers (e.g. years-old post timestamps) from the average
        const validHours =
          typeof hours === 'number' && hours >= 0 && hours <= 24 * 30 ? hours : null;
        if (validHours != null) {
          replyTimes.push(validHours);
        }
        repliedThreads.push({
          ...(m as ClassifiedMention),
          replyHours: validHours ?? (typeof hours === 'number' ? hours : null),
        });
      }
    });

    // Newest first so the drill-down list is scannable
    repliedThreads.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    // Show one decimal when < 1% so "2 of 648" is not rounded to a misleading 0%
    const rawRate = (replied / redditThreads.length) * 100;
    const rate = rawRate > 0 && rawRate < 1
      ? Math.round(rawRate * 10) / 10
      : Math.round(rawRate);
    const avg = replyTimes.length > 0
      ? Math.round((replyTimes.reduce((a, b) => a + b, 0) / replyTimes.length) * 10) / 10
      : null;

    return {
      responseRate: rate,
      officialReplies: replied,
      totalThreads: redditThreads.length,
      avgReplyHours: avg,
      repliedThreads,
    };
  }

  const asurionSupport = getSupportResponsiveness(asurionMentions, 'Asurion');
  const likewizeSupport = getSupportResponsiveness(likewizeMentions, 'Likewize');

  // Reusable clean hover popup for comparison charts (consistent card style with dashboard)
  const CustomComparisonTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div className="mv-tooltip p-3.5 min-w-[220px] text-sm">
        <div className="mv-section-title text-sm mb-2 pb-1.5 border-b border-[var(--border)]">{label}</div>
        <div className="space-y-2 pt-0.5">
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <div 
                  className="w-3 h-3 rounded-full flex-shrink-0" 
                  style={{ backgroundColor: entry.color }} 
                />
                <span className="text-[var(--muted-foreground)] font-medium">{entry.name}</span>
              </div>
              <span className="font-semibold tabular-nums text-[var(--foreground)]">{entry.value}%</span>
            </div>
          ))}
        </div>
        <div className="text-[10px] text-[var(--muted-foreground)] mt-2.5 pt-1.5 border-t border-[var(--border)]">Positive sentiment % on this pillar</div>
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

  // Share of voice among primary competitors (Asurion vs Allstate) — not Likewize-centric
  const asurionVol = asurionMentions.length;
  const allstateVol = allstateMentions.length;
  const competitorVoiceTotal = asurionVol + allstateVol;
  const voiceLeader =
    competitorVoiceTotal === 0
      ? null
      : asurionVol >= allstateVol
        ? { name: 'Asurion' as const, count: asurionVol, share: Math.round((asurionVol / competitorVoiceTotal) * 100) }
        : { name: 'Allstate' as const, count: allstateVol, share: Math.round((allstateVol / competitorVoiceTotal) * 100) };
  const asurionSent = getSentimentScore(asurionMentions);
  const allstateSent = getSentimentScore(allstateMentions);

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
      toast.error('Refresh failed — see console.');
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
          toast.success('Sync started in background', { description: 'Data is being fetched and saved. Click "Refresh" when ready to load the latest results.' });
        }
      })
      .catch((e: any) => {
        if (!isAuto) toast.error('Sync failed to start (check console + .env)');
        console.error('handleIngestAll:', e);
      })
      .finally(() => setTimeout(() => setIsIngesting(false), 550));
  }

  return (
    <div
      className="mv-app-shell flex flex-col lg:flex-row min-h-screen max-w-[100vw] overflow-x-hidden bg-[var(--background)] text-[var(--foreground)]"
      data-dashboard-ready={dataReady ? 'true' : 'false'}
    >
      {/* 1. Left Sidebar - Purple theme (collapses on mobile) */}
      <div
        className="w-full lg:w-64 lg:max-w-[16rem] flex-shrink-0 text-white flex flex-row lg:flex-col overflow-x-auto lg:overflow-visible"
        style={{ backgroundColor: PURPLE }}
      >
        <div className="p-6 flex items-center gap-3 border-b border-white/20">
          <div className="h-9 w-9 rounded-full bg-white flex items-center justify-center">
            <Star className="h-5 w-5" style={{ color: PURPLE }} />
          </div>
          <div>
            <div className="font-semibold text-lg tracking-tight">Market Vantage</div>
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
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg transition cursor-pointer ${isActive ? "font-medium bg-white/15 shadow-sm" : "text-white/80 hover:text-white hover:bg-white/10"}`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </a>
              );
            })}
          </nav>
        </div>

        {/* Bottom mini Sentiment Health + account */}
        <div className="m-4 space-y-3">
          <div className="p-3.5 rounded-xl bg-white/10 border border-white/15 backdrop-blur-sm">
            <div className="text-[10px] uppercase tracking-widest text-white/70 mb-1 flex items-center gap-1">
              <Activity className="h-3 w-3" /> Sentiment Health · {activeRange}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold">{healthScore}</span>
              <span className="text-xs text-white/70">/100</span>
            </div>
            <div className="text-xs text-white/70 mt-0.5">vs prior period</div>
          </div>
          <div className="px-1 flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-white/50">Account</span>
            <UserMenu />
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 max-w-full overflow-x-hidden">
        {/* Top header controls */}
        <div className="mv-topbar px-4 lg:px-6 py-2.5 lg:py-3 flex items-center gap-2 lg:gap-3 flex-wrap sticky top-0 z-30 min-w-0">
          <div className="mv-segment text-xs lg:text-sm order-2 lg:order-none">
            {timeRanges.map((range) => (
              <button
                key={range}
                onClick={() => setActiveRange(range)}
                className={`mv-segment-btn text-xs lg:text-sm ${activeRange === range ? "is-active" : ""}`}
              >
                {range}
              </button>
            ))}
          </div>

          {/* Global search: client · business line · source · thread */}
          <DashboardSearch
            mentions={searchPool}
            includeBusinessLines={activeTab === 'overview'}
            onSelectClient={(name) => {
              setActiveClient(name);
              setActiveSource('All');
            }}
            onSelectBusinessLine={(line) => {
              setActiveTab('overview');
              setActiveBusinessLine(line);
            }}
            onSelectSource={(source) => {
              setActiveSource(source);
            }}
            onSelectThread={(m) => {
              setSelectedInsight(m);
            }}
          />

          {/* Client filter — Overview: full native select. Competitor: custom menu, top 10 + Show more extends list in place */}
          <div className="flex items-center gap-1.5 order-3 lg:order-none flex-wrap">
            <span className="text-[10px] lg:text-xs text-[var(--muted-foreground)] font-medium whitespace-nowrap hidden sm:inline">
              Client
            </span>
            {activeTab === 'competitor' ? (
              <div className="relative z-40" ref={clientMenuRef}>
                <button
                  type="button"
                  id="client-filter"
                  aria-haspopup="listbox"
                  aria-expanded={clientMenuOpen}
                  onClick={() =>
                    setClientMenuOpen((o) => {
                      if (!o) setShowAllClients(false); // each open starts at top 10
                      return !o;
                    })
                  }
                  className="mv-select max-w-[180px] lg:max-w-[240px] text-xs lg:text-sm !inline-flex !items-center gap-1.5 cursor-pointer"
                  title="Top 10 clients — use Show more at the bottom of the list for the rest"
                >
                  <span className="truncate min-w-0">
                    {activeClient === 'All' ? 'All clients' : activeClient}
                  </span>
                  <span className="text-[var(--muted-foreground)] shrink-0 text-[10px]" aria-hidden>
                    ▾
                  </span>
                </button>
                {clientMenuOpen && (
                  <div
                    className="absolute top-[calc(100%+6px)] left-0 z-50 w-[min(18rem,90vw)] max-h-[min(20rem,60vh)] overflow-y-auto overflow-x-hidden rounded-xl border border-[var(--border)] bg-white p-1.5 shadow-lg flex flex-col gap-0.5"
                    role="listbox"
                    aria-label="Clients"
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={activeClient === 'All'}
                      className={`w-full flex items-center justify-between gap-3 text-left text-xs lg:text-sm px-2.5 py-2 rounded-lg border-0 cursor-pointer ${
                        activeClient === 'All'
                          ? 'bg-[var(--lw-primary-soft)] text-[var(--primary)] font-semibold'
                          : 'bg-transparent text-[var(--foreground)] font-medium hover:bg-[var(--muted)]'
                      }`}
                      onClick={() => {
                        setActiveClient('All');
                        setClientMenuOpen(false);
                        setShowAllClients(false);
                      }}
                    >
                      <span className="truncate">All clients</span>
                    </button>
                    {visibleClientOptions.map((c) => (
                      <button
                        type="button"
                        key={c.name}
                        role="option"
                        aria-selected={activeClient === c.name}
                        className={`w-full flex items-center text-left text-xs lg:text-sm px-2.5 py-2 rounded-lg border-0 cursor-pointer ${
                          activeClient === c.name
                            ? 'bg-[var(--lw-primary-soft)] text-[var(--primary)] font-semibold'
                            : 'bg-transparent text-[var(--foreground)] font-medium hover:bg-[var(--muted)]'
                        }`}
                        onClick={() => {
                          setActiveClient(c.name);
                          setClientMenuOpen(false);
                        }}
                      >
                        <span className="truncate min-w-0">{c.name}</span>
                      </button>
                    ))}
                    {showClientMoreOption && !showAllClients && (
                      <button
                        type="button"
                        className="w-full text-left text-xs font-semibold text-[var(--primary)] px-2.5 py-2.5 mt-0.5 border-0 border-t border-[var(--border)] rounded-b-lg bg-transparent cursor-pointer hover:bg-[var(--lw-primary-soft)]"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setShowAllClients(true);
                        }}
                      >
                        Show more ({hiddenClientCount}) →
                      </button>
                    )}
                    {showClientMoreOption && showAllClients && (
                      <button
                        type="button"
                        className="w-full text-left text-xs font-semibold text-[var(--primary)] px-2.5 py-2.5 mt-0.5 border-0 border-t border-[var(--border)] rounded-b-lg bg-transparent cursor-pointer hover:bg-[var(--lw-primary-soft)]"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setShowAllClients(false);
                        }}
                      >
                        ← Show less (top 10)
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <select
                id="client-filter"
                value={activeClient}
                onChange={(e) => setActiveClient(e.target.value)}
                className="mv-select max-w-[160px] lg:max-w-[220px] text-xs lg:text-sm"
                title="Filter dashboard by client / account"
              >
                <option value="All">All clients</option>
                {clientOptions.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            {activeClient !== 'All' && (
              <button
                type="button"
                onClick={() => setActiveClient('All')}
                className="text-[10px] lg:text-xs text-[var(--muted-foreground)] font-medium hover:underline whitespace-nowrap"
                title="Clear client filter"
              >
                Clear
              </button>
            )}
          </div>

          {/* Business line filter — Likewize Overview only */}
          {activeTab === 'overview' && (
            <div className="flex items-center gap-1.5 order-4 lg:order-none">
              <label htmlFor="bizline-filter" className="text-[10px] lg:text-xs text-[var(--muted-foreground)] font-medium whitespace-nowrap hidden sm:inline">
                Business line
              </label>
              <select
                id="bizline-filter"
                value={activeBusinessLine}
                onChange={(e) => setActiveBusinessLine(e.target.value as 'All' | BusinessLine)}
                className="mv-select max-w-[180px] lg:max-w-[240px] text-xs lg:text-sm"
                title="Filter Likewize Overview by business line (DP / HomeTech / Trade-In)"
              >
                <option value="All">All lines</option>
                {businessLineDistribution.map((b) => (
                  <option key={b.line} value={b.line}>
                    {b.label}
                  </option>
                ))}
              </select>
              {activeBusinessLine !== 'All' && (
                <button
                  type="button"
                  onClick={() => setActiveBusinessLine('All')}
                  className="text-[10px] lg:text-xs text-[var(--primary)] font-medium hover:underline whitespace-nowrap"
                  title="Clear business line filter"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {activeSource !== 'All' && (
            <div className="flex items-center gap-1.5 order-5 lg:order-none">
              <span className="mv-chip text-[10px] lg:text-xs font-medium px-2.5 py-1 text-[var(--foreground)]">
                Source: {activeSource}
              </span>
              <button
                type="button"
                onClick={() => setActiveSource('All')}
                className="text-[10px] lg:text-xs text-[var(--primary)] font-medium hover:underline whitespace-nowrap"
                title="Clear source filter"
              >
                Clear
              </button>
            </div>
          )}

          <div className="flex-1 min-w-0" />

          {/* Keep Sync + Refresh + Alerts on one line */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs lg:text-sm gap-1.5"
              onClick={() => setAlertEnrollOpen(true)}
              title="Get email + PDF when new threads match your clients or business lines"
            >
              <Bell className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Alerts</span>
            </Button>
            <Button
              onClick={() => handleIngestAll(false)}
              disabled={isIngesting}
              className="button-primary text-white gap-1.5 text-xs lg:text-sm"
              size="sm"
              title="Fetch new data from Reddit + PissedConsumer into the database"
            >
              {isIngesting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {isIngesting ? "Syncing..." : "Sync"}
            </Button>

            <Button
              onClick={refreshFromDatabase}
              variant="outline"
              size="sm"
              className="text-xs lg:text-sm"
              title="Reload the latest data from the database"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Dashboard + insights side-by-side; insights max-height = dashboard column height */}
        <div className="flex flex-col lg:flex-row lg:items-start min-w-0 max-w-full flex-1 overflow-x-hidden">
        <div ref={dashboardColRef} className="flex-1 min-w-0 max-w-full p-5 lg:p-7 space-y-5 lg:space-y-6 overflow-x-hidden">
          <div className="flex items-center gap-3">
            <h1 className="mv-page-title">
              {activeTab === 'overview' ? 'Overview' : 'Competitor Analysis'}
            </h1>
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

          {/* KPI strip — same surface language as rest of page */}
          <motion.div
            className="grid grid-cols-2 md:grid-cols-4 gap-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut', delay: 0.04 }}
          >
            {[
              {
                label: 'Likewize mentions',
                value: total,
                sub: `Only · ${activeRange}`,
              },
              {
                label: 'Positive sentiment',
                value: `${breakdown.positive}%`,
                sub: `${positiveCount} of ${total}`,
              },
              {
                label: 'Top client',
                value: retailerStats[0]?.name || '—',
                sub: `${retailerStats[0]?.mentions || 0} mentions`,
                valueClass: 'text-xl leading-snug break-words',
              },
              {
                label: 'Health',
                value: healthScore,
                sub: `Pos + Neu · ${activeRange}`,
              },
            ].map((kpi) => (
              <div key={kpi.label} className="mv-kpi p-4 min-w-0 overflow-hidden">
                <div className="mv-kpi-label">{kpi.label}</div>
                <div className={`mv-kpi-value min-w-0 ${kpi.valueClass || ''}`}>{kpi.value}</div>
                <div className="mv-kpi-sub">{kpi.sub}</div>
              </div>
            ))}
          </motion.div>

          {/* Main two-column area: Sentiment Health + Pillar Breakdown (Lovable layout) */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* SENTIMENT HEALTH Card - left, with gauge + breakdown */}
            <div className="lg:col-span-2 mv-card p-5 lg:p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="mv-section-title text-sm">Sentiment health</div>
                  <div className="mv-section-sub">Overall score from positive + neutral share</div>
                </div>
              </div>

              <div className="flex justify-center mb-2">
                {hasData ? (
                  <HealthGauge score={healthScore} />
                ) : (
                  <div className="w-[260px] h-[150px] flex items-center justify-center rounded-full border-2 border-dashed border-[var(--border)] text-center text-sm text-[var(--muted-foreground)]">
                    No real data yet
                  </div>
                )}
              </div>

              {/* Breakdown like Lovable - clean, no overlapping text */}
              <div className="flex justify-between text-center text-sm mt-1">
                <div className="flex-1">
                  <div className="font-semibold" style={{color: PINK}}>{breakdown.positive}%</div>
                  <div className="text-[10px] text-[var(--muted-foreground)] tracking-wide uppercase">Positive</div>
                </div>
                <div className="flex-1">
                  <div className="font-semibold" style={{color: '#00A8B8'}}>{breakdown.neutral}%</div>
                  <div className="text-[10px] text-[var(--muted-foreground)] tracking-wide uppercase">Neutral</div>
                </div>
                <div className="flex-1">
                  <div className="font-semibold" style={{color: PURPLE}}>{breakdown.negative}%</div>
                  <div className="text-[10px] text-[var(--muted-foreground)] tracking-wide uppercase">Negative</div>
                </div>
              </div>
            </div>

            {/* PILLAR BREAKDOWN Card - right, with stacked bars + 4 cards */}
            <div className="lg:col-span-3 mv-card p-4 lg:p-6">
              {/* Header */}
              <div className="flex items-start justify-between mb-3 gap-3">
                <div>
                  <div className="mv-section-title text-base">Pillar breakdown</div>
                  <div className="mv-section-sub">Hover for detail · click a pillar to drill down</div>
                </div>
                <div className="mv-chip text-[10px] font-medium px-2.5 py-1 text-[var(--muted-foreground)] tabular-nums whitespace-nowrap">
                  {activeRange}
                </div>
              </div>

              {drillPillar && (
                <div className="mb-2 mv-chip inline-flex items-center gap-1 text-xs text-[var(--primary)] px-2.5 py-0.5">
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
                      className={`flex-1 text-center cursor-pointer transition-all duration-300 ease-out ${isDrilled ? 'ring-1 ring-[var(--primary)] rounded' : ''}`}
                    >
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#1E1B4B", lineHeight: "1.1" }}>{p.name}</div>
                    </div>
                  );
                })}
              </div>

              {/* Bars with Y-axis and X-axis */}
              <div className="flex gap-1 mb-1">
                {/* Y-axis */}
                <div className="relative flex-shrink-0 w-8 text-[9px] text-[var(--muted-foreground)] flex flex-col justify-between h-28 lg:h-32">
                  <div className="text-right leading-none">100%</div>
                  <div className="text-right leading-none">75%</div>
                  <div className="text-right leading-none">50%</div>
                  <div className="text-right leading-none">25%</div>
                  <div className="text-right leading-none">0%</div>
                  {/* Vertical Y-axis line */}
                  <div className="absolute top-0 bottom-0 right-0 border-r border-[var(--border-strong)]"></div>
                </div>

                {/* Bars area with X-axis */}
                <div className="flex-1 relative h-28 lg:h-32">
                  {/* Light gridlines */}
                  <div className="absolute inset-0 z-0 pointer-events-none">
                    <div className="absolute left-0 right-0 top-[25%] border-t border-[var(--border)]/40"></div>
                    <div className="absolute left-0 right-0 top-[50%] border-t border-[var(--border)]/40"></div>
                    <div className="absolute left-0 right-0 top-[75%] border-t border-[var(--border)]/40"></div>
                  </div>

                  <div className="flex gap-2 lg:gap-3 h-full">
                    {pillarStats.map((p, idx) => {
                      const posPct = p.positive || 0;
                      const neuPct = p.neutral || 0;
                      const negPct = p.negative || 0;
                      // Brand stack: pink = positive, soft cyan = neutral, deep blue = negative
                      const posColor = PINK; // #FF96FF
                      const neuColor = '#C8FAFA'; // protect.likewize soft cyan (bar fill)
                      const neuText = '#00A8B8'; // readable cyan for labels
                      const negColor = PURPLE; // #3200BE instead of red
                      const isDrilled = drillPillar === p.name;
                      const isHovered = hoveredPillar === p.name;
                      return (
                        <div 
                          key={idx} 
                          className={`flex-1 flex justify-center group min-w-0 cursor-pointer transition-all duration-300 ease-out ${isDrilled ? 'ring-1 ring-[var(--primary)] rounded' : ''}`}
                          onMouseEnter={() => setHoveredPillar(p.name as Pillar)}
                          onMouseLeave={() => setHoveredPillar(null)}
                          onClick={() => setDrillPillar(drillPillar === p.name ? null : p.name as Pillar)}
                        >
                          <div className="relative w-12 lg:w-16 h-full">
                            <div 
                              className={`relative w-full h-full bg-transparent rounded-t-lg overflow-hidden border border-[var(--border)] transition-all duration-300 ease-out group-hover:border-[var(--border-strong)] ${isHovered ? 'scale-[1.02] shadow-sm' : ''}`}
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
                              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-50 mv-tooltip p-2 text-[10px] w-32 pointer-events-none">
                                <div className="font-semibold text-[var(--foreground)] text-center text-[10px] border-b border-[var(--border)] pb-0.5 mb-1">{p.name}</div>
                                <div className="space-y-[1px]">
                                  <div className="flex justify-between items-center">
                                    <span style={{color: posColor}} className="flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-sm" style={{backgroundColor: posColor}}></span> Pos</span>
                                    <span className="font-medium tabular-nums">{posPct}%</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span style={{color: neuText}} className="flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-sm" style={{backgroundColor: neuColor}}></span> Neu</span>
                                    <span className="font-medium tabular-nums">{neuPct}%</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span style={{color: negColor}} className="flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-sm" style={{backgroundColor: negColor}}></span> Neg</span>
                                    <span className="font-medium tabular-nums">{negPct}%</span>
                                  </div>
                                </div>
                                <div className="text-[8px] text-[var(--muted-foreground)] text-center mt-1 pt-0.5 border-t border-[var(--border)]">{p.mentions} mentions</div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* X-axis baseline */}
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-[var(--border)]"></div>
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
                      className={`flex-1 text-center text-[11px] text-[var(--muted-foreground)] tabular-nums cursor-pointer transition-all duration-300 ease-out ${isDrilled ? 'ring-1 ring-[var(--primary)] rounded' : ''}`}
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
                      className={`flex-1 mv-inset-interactive p-2.5 lg:p-3 text-xs min-w-0 ${isDrilled ? 'is-active' : ''}`}
                    >
                      <div className="mv-tile-title text-[11px] tracking-tight">{label}</div>

                      {/* Clean grouped percentages - no confusing minus signs, proper colors and spacing */}
                      <div className="mv-tile-meta mt-1 text-[9px] leading-tight">
                        <span style={{ color: PINK }} className="font-medium">{p.positive}% pos</span>
                        <span style={{ color: '#00A8B8' }} className="font-medium">{p.neutral}% neu</span>
                        <span style={{ color: PURPLE }} className="font-medium">{p.negative}% neg</span>
                      </div>

                      <div className="text-[9px] text-[var(--muted-foreground)] mt-px tabular-nums">{p.mentions} mentions</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Mentions by business line + source — large pie, tight card/legend padding */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* BUSINESS LINE — solid pie + callouts Name (n) */}
            <div className="mv-card px-2.5 pt-3 pb-2 sm:px-3 sm:pt-3.5 sm:pb-2.5 min-w-0 overflow-visible">
              <div className="flex items-start justify-between gap-2 mb-0">
                <div className="min-w-0">
                  <div className="mv-section-title text-sm">Mentions by business line</div>
                  <div className="mv-section-sub">Share of total volume across each business line</div>
                </div>
                <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                  <div className="text-base sm:text-lg font-semibold tabular-nums text-[var(--foreground)] leading-none">
                    {likewizePoolForBizLine.length}
                  </div>
                  <div className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wide">total</div>
                  {activeBusinessLine !== 'All' && (
                    <button
                      type="button"
                      onClick={() => setActiveBusinessLine('All')}
                      className="text-xs font-medium text-[var(--primary)] hover:underline"
                    >
                      Clear filter
                    </button>
                  )}
                </div>
              </div>

              {businessLineDistribution.some((b) => b.count > 0) ? (
                <div className="mv-pie-panel">
                  <div className="mv-pie-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart margin={{ top: 18, right: 22, bottom: 18, left: 22 }}>
                        <Pie
                          data={businessLineDistribution.filter((b) => b.count > 0)}
                          dataKey="count"
                          nameKey="label"
                          cx="50%"
                          cy="50%"
                          outerRadius="58%"
                          innerRadius={0}
                          paddingAngle={1.5}
                          stroke="#fff"
                          strokeWidth={2}
                          labelLine={false}
                          label={(props) => (
                            <PieCalloutLabel {...props} style="paren" />
                          )}
                          isAnimationActive={false}
                          onClick={(_, index) => {
                            const rows = businessLineDistribution.filter((b) => b.count > 0);
                            const entry = rows[index];
                            if (!entry) return;
                            setActiveBusinessLine(
                              activeBusinessLine === entry.line ? 'All' : entry.line,
                            );
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          {businessLineDistribution
                            .filter((b) => b.count > 0)
                            .map((entry, index) => (
                              <Cell
                                key={`biz-pie-${index}`}
                                fill={entry.fill}
                                opacity={
                                  activeBusinessLine === 'All' || activeBusinessLine === entry.line
                                    ? 1
                                    : 0.35
                                }
                                stroke={activeBusinessLine === entry.line ? PURPLE : '#fff'}
                                strokeWidth={activeBusinessLine === entry.line ? 3 : 2}
                              />
                            ))}
                        </Pie>
                        <Tooltip
                          formatter={(value, name) => [`${value ?? 0} mentions`, name]}
                          contentStyle={{
                            borderRadius: 10,
                            border: '1px solid #E2E8F0',
                            fontSize: 12,
                            boxShadow: '0 4px 12px rgba(15,23,42,0.08)',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-[10px] text-center text-[var(--muted-foreground)] mt-0 mb-0 leading-tight">
                    Click a slice to filter · click again to clear
                  </p>
                </div>
              ) : (
                <div className="mv-empty h-[140px]">No business-line data in this window.</div>
              )}
            </div>

            {/* SOURCE — donut + callouts Name · n + bottom legend */}
            <div className="mv-card px-2.5 pt-3 pb-2 sm:px-3 sm:pt-3.5 sm:pb-2 min-w-0 overflow-visible">
              <div className="flex items-start justify-between gap-2 mb-0">
                <div className="min-w-0">
                  <div className="mv-section-title text-sm">Mentions by source</div>
                  <div className="mv-section-sub">Where the conversation is happening</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-base sm:text-lg font-semibold tabular-nums text-[var(--foreground)] leading-none">
                    {likewizeTotal}
                  </div>
                  <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5 uppercase tracking-wide">
                    total
                  </div>
                </div>
              </div>

              {sourceDistribution.some((s) => s.count > 0) ? (
                <div className="mv-pie-panel">
                  <div className="mv-pie-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart margin={{ top: 18, right: 24, bottom: 12, left: 24 }}>
                        <Pie
                          data={sourceDistribution.filter((s) => s.count > 0)}
                          dataKey="count"
                          nameKey="source"
                          cx="50%"
                          cy="50%"
                          outerRadius="56%"
                          innerRadius="32%"
                          paddingAngle={2}
                          stroke="#fff"
                          strokeWidth={2}
                          labelLine={false}
                          label={(props) => <PieCalloutLabel {...props} style="dot" />}
                          isAnimationActive={false}
                        >
                          {sourceDistribution
                            .filter((s) => s.count > 0)
                            .map((entry, index) => (
                              <Cell key={`source-pie-${index}`} fill={entry.fill} />
                            ))}
                        </Pie>
                        <Tooltip
                          formatter={(value, name) => [`${value ?? 0} mentions`, name]}
                          contentStyle={{
                            borderRadius: 10,
                            border: '1px solid #E2E8F0',
                            fontSize: 12,
                            boxShadow: '0 4px 12px rgba(15,23,42,0.08)',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <div className="mv-empty h-[140px]">No source data in this window.</div>
              )}
            </div>
          </div>

          {/* Top pain points / what customers love — concrete issues, not raw keywords */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="mv-card p-4 sm:p-5 min-w-0">
              <div className="mb-4">
                <div className="text-base font-semibold tracking-tight" style={{ color: '#E11D48' }}>
                  Top pain points
                </div>
                <div className="mv-section-sub">
                  What’s actually broken — portal, replacement quality, repair service, and more
                  {activeBusinessLine !== 'All' ? ` · ${formatBusinessLine(activeBusinessLine)}` : ''}
                </div>
              </div>
              {topPainPoints.length === 0 ? (
                <div className="text-sm text-[var(--muted-foreground)] py-6 text-center">
                  No clear pain themes in this window. Try All dates or clear filters.
                </div>
              ) : (
                <ul className="space-y-3">
                  {topPainPoints.map((t) => {
                    const max = topPainPoints[0]?.mentions || 1;
                    const width = Math.max(6, Math.round((t.mentions / max) * 100));
                    const isOpen = themeDrill?.id === t.id;
                    return (
                      <li key={t.id} className="min-w-0">
                        <button
                          type="button"
                          onClick={() => setThemeDrill(isOpen ? null : t)}
                          title={`${t.insight} — click to view ${t.mentions} threads`}
                          className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all ${
                            isOpen
                              ? 'border-[rgba(225,29,72,0.35)] bg-[#FFF5F7] shadow-sm'
                              : 'border-transparent hover:border-[var(--border)] hover:bg-[var(--muted)]/60'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3 mb-1.5">
                            <div className="min-w-0">
                              <div className="font-semibold text-sm text-[var(--foreground)] leading-snug">
                                {t.label}
                              </div>
                              <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5 leading-snug line-clamp-2">
                                {t.insight}
                              </div>
                            </div>
                            <div className="shrink-0 text-right text-[11px] text-[var(--muted-foreground)] leading-snug">
                              <span className="whitespace-nowrap">
                                {t.businessLineLabel} · {t.mentions} ·{' '}
                                <span className="font-semibold text-[var(--foreground)]">{t.pct}%</span>
                              </span>
                              <div className="text-[10px] font-medium text-[var(--primary)] mt-0.5">
                                {isOpen ? 'Close' : 'View threads →'}
                              </div>
                            </div>
                          </div>
                          <div className="h-2 w-full rounded-full bg-[#EDE7F8] overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{ width: `${width}%`, backgroundColor: '#E11D48' }}
                            />
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="mv-card p-4 sm:p-5 min-w-0">
              <div className="mb-4">
                <div className="text-base font-semibold tracking-tight" style={{ color: '#059669' }}>
                  What customers love
                </div>
                <div className="mv-section-sub">
                  Top drivers of positive sentiment — what worked, not just nice words
                  {activeBusinessLine !== 'All' ? ` · ${formatBusinessLine(activeBusinessLine)}` : ''}
                </div>
              </div>
              {topLoveDrivers.length === 0 ? (
                <div className="text-sm text-[var(--muted-foreground)] py-6 text-center">
                  No clear positive themes in this window yet.
                </div>
              ) : (
                <ul className="space-y-3">
                  {topLoveDrivers.map((t) => {
                    const max = topLoveDrivers[0]?.mentions || 1;
                    const width = Math.max(6, Math.round((t.mentions / max) * 100));
                    const isOpen = themeDrill?.id === t.id;
                    return (
                      <li key={t.id} className="min-w-0">
                        <button
                          type="button"
                          onClick={() => setThemeDrill(isOpen ? null : t)}
                          title={`${t.insight} — click to view ${t.mentions} threads`}
                          className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all ${
                            isOpen
                              ? 'border-[rgba(5,150,105,0.35)] bg-[#F0FDF8] shadow-sm'
                              : 'border-transparent hover:border-[var(--border)] hover:bg-[var(--muted)]/60'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3 mb-1.5">
                            <div className="min-w-0">
                              <div className="font-semibold text-sm text-[var(--foreground)] leading-snug">
                                {t.label}
                              </div>
                              <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5 leading-snug line-clamp-2">
                                {t.insight}
                              </div>
                            </div>
                            <div className="shrink-0 text-right text-[11px] text-[var(--muted-foreground)] leading-snug">
                              <span className="whitespace-nowrap">
                                {t.businessLineLabel} · {t.mentions} ·{' '}
                                <span className="font-semibold text-[var(--foreground)]">{t.pct}%</span>
                              </span>
                              <div className="text-[10px] font-medium text-[var(--primary)] mt-0.5">
                                {isOpen ? 'Close' : 'View threads →'}
                              </div>
                            </div>
                          </div>
                          <div className="h-2 w-full rounded-full bg-[#EDE7F8] overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{ width: `${width}%`, backgroundColor: '#059669' }}
                            />
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Retailer / Client Breakdown - kept as before for functionality, styled to match */}
          <motion.div 
            className="mv-card p-5 lg:p-6"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut", delay: 0.1 }}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="mv-section-title text-base">Breakdown by retailer / client</div>
                <div className="mv-section-sub">Partner channels only (Rogers, Newegg, etc.)</div>
              </div>
              <div className="mv-chip text-xs font-medium px-2.5 py-1 text-[var(--muted-foreground)] tabular-nums whitespace-nowrap">
                {activeRange}
              </div>
            </div>

            {retailerStats.length === 0 ? (
              <div className="text-sm text-[var(--muted-foreground)] py-2">No retailer-specific data in the current filter. {isSupabaseConfigured ? 'Run ingestion (manual button) or loosen the date range.' : 'Supabase not configured (see red banner above).'} </div>
            ) : (
              <ChartContainer
                config={{
                  positive: { label: "Positive", color: PINK },
                  neutral: { label: "Neutral", color: '#C8FAFA' },
                  negative: { label: "Negative", color: PURPLE },
                }}
                className="!aspect-auto h-[260px] w-full min-h-[260px]"
              >
                <BarChart
                  data={retailerStats.map((r) => ({
                    name: r.name.length > 14 ? `${r.name.slice(0, 13)}…` : r.name,
                    fullName: r.name,
                    positive: r.positive,
                    neutral: r.neutral,
                    negative: r.negative,
                    total: r.mentions,
                  }))}
                  margin={{ top: 12, right: 12, left: 4, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} width={40} />
                  <Tooltip
                    content={<ChartTooltipContent />}
                    labelFormatter={(_, payload) =>
                      (payload?.[0]?.payload as { fullName?: string } | undefined)?.fullName || _
                    }
                  />
                  <Bar dataKey="positive" stackId="a" fill={PINK} name="Positive" />
                  <Bar dataKey="neutral" stackId="a" fill="#C8FAFA" name="Neutral" />
                  <Bar dataKey="negative" stackId="a" fill={PURPLE} name="Negative" />
                </BarChart>
              </ChartContainer>
            )}

            <div className="mv-grid-tiles text-sm mt-6">
              {retailerStats.map((r, i) => {
                const total = r.mentions || 1;
                const posPct = Math.round((r.positive / total) * 100);
                const neuPct = Math.round((r.neutral / total) * 100);
                const negPct = Math.round((r.negative / total) * 100);
                const isActive = activeClient === r.name;
                return (
                  <button
                    type="button"
                    key={i}
                    onClick={() => setActiveClient(isActive ? 'All' : r.name)}
                    title={isActive ? `Clear filter (${r.name})` : `Filter dashboard to ${r.name}`}
                    className={`text-left mv-inset-interactive p-3 lg:p-3.5 w-full min-w-0 ${isActive ? 'is-active' : ''}`}
                  >
                    <div className="mv-tile-title text-sm lg:text-[0.95rem]" title={r.name}>
                      {r.name}
                    </div>
                    <div className="text-[var(--muted-foreground)] text-xs lg:text-sm mt-0.5 tabular-nums">
                      {r.mentions} total
                    </div>
                    <div className="mv-tile-meta mt-2 text-[10px] lg:text-xs">
                      <span style={{ color: PINK }}>{posPct}% +</span>
                      <span style={{ color: CYAN }}>{neuPct}% ~</span>
                      <span style={{ color: PURPLE }}>{negPct}% -</span>
                    </div>
                    <div className="mt-1.5 text-[10px] text-[var(--primary)] font-medium leading-snug">
                      {isActive ? 'Filtered · click to clear' : 'Click to filter'}
                    </div>
                  </button>
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
              {/* Main Two Column Layout — equal-height cards */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                {/* Left: Comparative Performance */}
                <div className="mv-card p-5 lg:p-6 flex flex-col min-h-[480px] h-full">
                  <div className="shrink-0 mb-4">
                    <div className="mv-section-title">Comparative performance</div>
                    <div className="mv-section-sub">
                      Positive sentiment % by pillar — Likewize vs Asurion
                    </div>
                  </div>
                  <div className="flex-1 min-h-[360px] w-full">
                    {competitorMounted && asurionLikewizeRadarData.some(r => (r.Likewize + r.Asurion) > 0) ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={asurionLikewizeRadarData} barGap={8} barSize={18} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                          <XAxis
                            dataKey="subject"
                            tick={{ fontSize: 10, fontWeight: 500, fill: '#475569' }}
                            interval={0}
                            angle={-15}
                            textAnchor="end"
                            height={48}
                            tickLine={false}
                            axisLine={{ stroke: '#e2e8f0' }}
                          />
                          <YAxis
                            domain={[0, yDomainMax]}
                            tickCount={Math.min(6, Math.max(2, Math.floor(yDomainMax / 10) + 1))}
                            tick={{ fontSize: 10, fill: '#64748b' }}
                            axisLine={false}
                            tickLine={false}
                            width={32}
                          />
                          <Tooltip content={CustomComparisonTooltip} />
                          <Legend verticalAlign="bottom" height={28} wrapperStyle={{ fontSize: '11px', paddingTop: 4 }} />
                          <Bar dataKey="Likewize" name="Likewize" fill={PURPLE} radius={[3, 3, 0, 0]} />
                          <Bar dataKey="Asurion" name="Asurion" fill={PINK} radius={[3, 3, 0, 0]} />
                          <Bar dataKey="Allstate" name="Allstate" fill={CYAN} radius={[3, 3, 0, 0]} />
                          <Bar dataKey="SquareTrade" name="SquareTrade" fill="#6D28D9" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="mv-empty h-full text-xs">
                        Limited competitor data in current window.<br />
                        Use Sync, then Refresh to load reviews.
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Key Highlights — same outer card height, stacked tiles fill space */}
                <div className="mv-card p-5 lg:p-6 flex flex-col min-h-[480px] h-full">
                  <div className="shrink-0 mb-4">
                    <div className="mv-section-title">Key highlights</div>
                    <div className="mv-section-sub">Snapshot metrics from the current filter window</div>
                  </div>
                  <div className="flex flex-col gap-3 flex-1 min-h-0">
                    <div className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--muted)]/70 px-4 py-3.5 flex flex-col justify-center">
                      <div className="mv-kpi-label">Best avg rating</div>
                      <div className="mt-1.5 text-lg font-semibold text-[var(--foreground)] leading-snug">
                        {bestRatingComp && bestRatingComp.avg != null
                          ? `${bestRatingComp.name} — ${Math.round(bestRatingComp.avg / 100 * 5 * 10) / 10} / 5`
                          : 'N/A'}
                      </div>
                      <div className="mv-section-sub mt-1.5">
                        From star ratings on BBB (and other rated sources) in this window.
                      </div>
                    </div>

                    <div className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--muted)]/70 px-4 py-3.5 flex flex-col justify-center">
                      <div className="mv-kpi-label">Fastest resolution</div>
                      <div className="mt-1.5 text-lg font-semibold text-[var(--foreground)] leading-snug">
                        {fastestResComp && fastestResComp.res != null
                          ? `${fastestResComp.name} (Replacement pos: ${fastestResComp.res}%)`
                          : 'N/A'}
                      </div>
                      <div className="mv-section-sub mt-1.5">
                        Proxy from positive sentiment on the Replacement pillar.
                      </div>
                    </div>

                    <div className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--muted)]/70 px-4 py-3.5 flex flex-col justify-center">
                      <div className="mv-kpi-label">Share of voice</div>
                      <div className="mt-1.5 text-lg font-semibold text-[var(--foreground)] leading-snug">
                        {voiceLeader
                          ? `${voiceLeader.name} — ${voiceLeader.share}% of mentions`
                          : 'N/A'}
                      </div>
                      <div className="mv-section-sub mt-1.5">
                        {voiceLeader
                          ? `Asurion ${asurionVol.toLocaleString()} · Allstate ${allstateVol.toLocaleString()}` +
                            (asurionSent != null || allstateSent != null
                              ? ` · Pos ${asurionSent ?? '—'}% / ${allstateSent ?? '—'}%`
                              : '')
                          : 'Asurion vs Allstate mention volume in this window.'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Competitor source mix — large donut + callouts; extra side margin so labels don’t clip */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="mv-card px-2 pt-3 pb-2 sm:px-2.5 sm:pt-3.5 sm:pb-2.5 min-w-0 overflow-visible">
                  <div className="flex items-start justify-between gap-2 mb-0 px-1">
                    <div className="min-w-0">
                      <div className="mv-section-title text-sm">Asurion sources</div>
                      <div className="mv-section-sub">Where Asurion conversation is happening</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-base sm:text-lg font-semibold tabular-nums leading-none text-[var(--foreground)]">
                        {asurionMentions.length}
                      </div>
                      <div className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wide mt-0.5">
                        total
                      </div>
                    </div>
                  </div>
                  {asurionSourceMix.some((s) => s.count > 0) ? (
                    <div className="mv-pie-panel">
                      <div className="mv-pie-chart mv-pie-chart--competitor">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart margin={{ top: 24, right: 52, bottom: 28, left: 52 }}>
                            <Pie
                              data={asurionSourceMix.filter((s) => s.count > 0)}
                              dataKey="count"
                              nameKey="source"
                              cx="50%"
                              cy="50%"
                              outerRadius="48%"
                              innerRadius="28%"
                              paddingAngle={2}
                              stroke="#fff"
                              strokeWidth={2}
                              labelLine={false}
                              label={(props) => <PieCalloutLabel {...props} style="dot" />}
                              isAnimationActive={false}
                            >
                              {asurionSourceMix
                                .filter((s) => s.count > 0)
                                .map((entry, i) => (
                                  <Cell key={`asurion-src-${i}`} fill={entry.fill} />
                                ))}
                            </Pie>
                            <Tooltip
                              formatter={(value, name) => [`${value ?? 0} mentions`, name]}
                              contentStyle={{
                                borderRadius: 10,
                                border: '1px solid #E2E8F0',
                                fontSize: 12,
                                boxShadow: '0 4px 12px rgba(15,23,42,0.08)',
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ) : (
                    <div className="mv-empty py-6">
                      No Asurion data yet. Run Sync to pull Reddit + BBB reviews.
                    </div>
                  )}
                </div>

                <div className="mv-card px-2 pt-3 pb-2 sm:px-2.5 sm:pt-3.5 sm:pb-2.5 min-w-0 overflow-visible">
                  <div className="flex items-start justify-between gap-2 mb-0 px-1">
                    <div className="min-w-0">
                      <div className="mv-section-title text-sm">Likewize sources</div>
                      <div className="mv-section-sub">Where Likewize conversation is happening</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-base sm:text-lg font-semibold tabular-nums leading-none text-[var(--foreground)]">
                        {likewizeMentions.length}
                      </div>
                      <div className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wide mt-0.5">
                        total
                      </div>
                    </div>
                  </div>
                  {likewizeCompetitorSourceMix.some((s) => s.count > 0) ? (
                    <div className="mv-pie-panel">
                      <div className="mv-pie-chart mv-pie-chart--competitor">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart margin={{ top: 24, right: 52, bottom: 28, left: 52 }}>
                            <Pie
                              data={likewizeCompetitorSourceMix.filter((s) => s.count > 0)}
                              dataKey="count"
                              nameKey="source"
                              cx="50%"
                              cy="50%"
                              outerRadius="48%"
                              innerRadius="28%"
                              paddingAngle={2}
                              stroke="#fff"
                              strokeWidth={2}
                              labelLine={false}
                              label={(props) => <PieCalloutLabel {...props} style="dot" />}
                              isAnimationActive={false}
                            >
                              {likewizeCompetitorSourceMix
                                .filter((s) => s.count > 0)
                                .map((entry, i) => (
                                  <Cell key={`lw-src-${i}`} fill={entry.fill} />
                                ))}
                            </Pie>
                            <Tooltip
                              formatter={(value, name) => [`${value ?? 0} mentions`, name]}
                              contentStyle={{
                                borderRadius: 10,
                                border: '1px solid #E2E8F0',
                                fontSize: 12,
                                boxShadow: '0 4px 12px rgba(15,23,42,0.08)',
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ) : (
                    <div className="mv-empty py-6">
                      No Likewize competitor-window data.
                    </div>
                  )}
                </div>
              </div>

              {/* Support Team Responsiveness — Asurion (Asurion_Sam) vs Likewize only (other competitors removed for this metric) */}
              <div className="mv-card p-5 lg:p-6">
                <div className="mv-section-title mb-0.5">Official support responsiveness</div>
                <div className="mv-section-sub mb-4">Reddit threads only. Asurion counts replies from u/Asurion_Sam only. Likewize has no known official Reddit account — post text mentioning the brand does not count as a reply.</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="mv-inset p-4">
                    <div className="font-medium tracking-tight text-[var(--foreground)]">Likewize</div>
                    <div className="text-[10px] text-[var(--muted-foreground)] mb-1">No official Reddit account known</div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-3xl font-semibold tabular-nums text-[var(--primary)]">{likewizeSupport.responseRate}</span>
                      <span className="text-sm text-[var(--muted-foreground)]">% with official reply</span>
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)] mt-1">{likewizeSupport.officialReplies} of {likewizeSupport.totalThreads} Reddit threads</div>
                    {likewizeSupport.avgReplyHours !== null && (
                      <div className="text-xs mt-2 text-[var(--muted-foreground)]">Avg first reply time: <span className="font-medium text-[var(--foreground)]">{likewizeSupport.avgReplyHours} hours</span></div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (asurionSupport.officialReplies > 0) setShowAsurionSamThreads(true);
                    }}
                    disabled={asurionSupport.officialReplies === 0}
                    className={`w-full text-left p-4 ${
                      asurionSupport.officialReplies > 0
                        ? 'mv-inset-interactive'
                        : 'mv-inset opacity-90 cursor-default'
                    }`}
                    title={
                      asurionSupport.officialReplies > 0
                        ? 'View Reddit threads where Asurion_Sam replied'
                        : 'No Asurion_Sam replies in this window'
                    }
                  >
                    <div className="font-medium tracking-tight text-[var(--foreground)]">Asurion (via Asurion_Sam)</div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-3xl font-semibold tabular-nums text-[var(--primary)]">{asurionSupport.responseRate}</span>
                      <span className="text-sm text-[var(--muted-foreground)]">% with Asurion_Sam reply</span>
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)] mt-1">{asurionSupport.officialReplies} of {asurionSupport.totalThreads} Reddit threads</div>
                    {asurionSupport.avgReplyHours !== null && (
                      <div className="text-xs mt-2 text-[var(--muted-foreground)]">Avg first reply time: <span className="font-medium text-[var(--foreground)]">{asurionSupport.avgReplyHours} hours</span></div>
                    )}
                    {asurionSupport.officialReplies > 0 && (
                      <div className="text-[11px] font-medium text-[var(--primary)] mt-2.5">
                        View {asurionSupport.officialReplies} thread{asurionSupport.officialReplies === 1 ? '' : 's'} Asurion_Sam replied to →
                      </div>
                    )}
                  </button>
                </div>
                <div className="text-[10px] text-[var(--muted-foreground)] mt-3">Only Likewize and Asurion are compared for official support metrics.</div>
              </div>

              {/* Pillar-wise Competitor Breakdown - focus on key pillars */}
              <div className="mv-card p-5 lg:p-6">
                <div className="mv-section-title">Pillar breakdown</div>
                <div className="mv-section-sub mb-4">Claims · Repair · Replacement · Reimbursements · Call Center — positive % (Likewize vs Asurion)</div>
                <div className="mv-scroll-x">
                  <table className="mv-table w-full min-w-[320px]">
                    <thead>
                      <tr>
                        <th>Pillar</th>
                        <th>Likewize</th>
                        <th>Asurion</th>
                        <th className="text-right">Leader</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pillarBreakdownByCompetitor.map((p, i) => (
                        <tr key={i}>
                          <td className="font-medium">{p.pillar}</td>
                          <td className="tabular-nums">{p.likewize}% ({p.likewizeCount})</td>
                          <td className="tabular-nums">{p.asurion}% ({p.asurionCount})</td>
                          <td className="text-xs text-right text-[var(--muted-foreground)]">{p.asurion > p.likewize ? 'Asurion' : p.likewize > p.asurion ? 'Likewize' : 'Tie'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* COMPETITIVE MATRIX (clean, no NPS/Retention columns) */}
              <div className="mv-card p-5 lg:p-6">
                <div className="mv-section-title">Competitive matrix</div>
                <div className="mv-section-sub mb-4">Brand-level rating, resolution proxy, sentiment, and recovery</div>
                <div className="mv-scroll-x">
                  <table className="mv-table w-full min-w-[360px]">
                    <thead>
                      <tr>
                        <th>Brand</th>
                        <th>Avg rating</th>
                        <th>Resolution</th>
                        <th>Sentiment</th>
                        <th>Recovery %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comps.map((c, i) => {
                        const brandColor = c.name === 'Likewize' ? PURPLE : c.name === 'Asurion' ? PINK : CYAN;
                        const resScore = c.res != null ? c.res : '—';
                        const sentVal = c.sent != null ? `${c.sent}%` : '—';
                        const brandMentions = c.name === 'Likewize' ? likewizeMentions : asurionMentions;
                        const recovery = computeRecoveryRate(brandMentions);
                        return (
                          <tr key={i}>
                            <td className="font-medium" style={{color: brandColor}}>{c.name}</td>
                            <td className="tabular-nums">{c.avg != null ? Math.round(c.avg / 100 * 5 * 10)/10 : '—'} / 5</td>
                            <td className="tabular-nums">{resScore}{resScore !== '—' ? '%' : ''} <span className="text-[10px] text-[var(--muted-foreground)]">(higher = faster proxy)</span></td>
                            <td className="tabular-nums">{sentVal}</td>
                            <td className="tabular-nums">{recovery}% <span className="text-[10px] text-[var(--muted-foreground)]">(neg + positive reply)</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="text-[10px] text-[var(--muted-foreground)] mt-3">Resolution = positive % on Replacement pillar. Recovery = negatives with supportive reply in thread.</div>
              </div>

              {/* Competitor Recent Mentions */}
              <div className="mv-card p-5 lg:p-6">
                <div className="mv-section-title mb-1">Recent competitor mentions</div>
                <div className="mv-section-sub mb-4">Asurion / SquareTrade and related competitors</div>
                {competitorMentions.length === 0 ? (
                  <div className="text-sm text-[var(--muted-foreground)]">No competitor data yet. Use Sync, then Refresh.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    {competitorMentions
                      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                      .slice(0, 8)
                      .map((m, idx) => (
                        <div key={idx} onClick={() => setSelectedInsight(m)} className="mv-inset-interactive p-3.5 cursor-pointer min-w-0">
                          <div className="flex justify-between text-xs text-[var(--muted-foreground)] gap-2 min-w-0">
                            <span className="font-medium min-w-0 break-words">
                              {m.company} · {formatMentionSourceLabel(m.source)}
                            </span>
                            <span className="shrink-0 tabular-nums">{new Date(m.created_at).toLocaleDateString()}</span>
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-[var(--foreground)] leading-snug break-words">{m.text}</p>
                          <div className="mt-2">
                            <span className={`mv-pill ${m.sentiment === 'positive' ? 'mv-pill-pos' : m.sentiment === 'negative' ? 'mv-pill-neg' : 'mv-pill-neu'}`}>
                              {m.sentiment}
                            </span>
                            <span className="text-[10px] text-[var(--muted-foreground)] ml-2">
                              {m.pillar}{m.rating != null ? ` · ${m.rating}★` : ''}
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <div className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                All data shown here is strictly filtered to <strong className="text-[var(--foreground)]">electronic device protection</strong> (phones, gadgets, electronics plans). Non-relevant categories are excluded at query, scrape, filter, and classification time.
              </div>
            </div>
        </div>

      {/* Right rail — exact height match to dashboard column; scrolls if more insights */}
      <aside
        className="w-full lg:w-64 xl:w-72 lg:max-w-[18rem] flex-shrink-0 border-t lg:border-t-0 lg:border-l border-[var(--border)] mv-sidebar-rail bg-[var(--card)] p-3 lg:p-4 lg:overflow-y-auto self-start box-border min-w-0"
        style={
          isDesktop && insightsHeight
            ? { height: insightsHeight, maxHeight: insightsHeight }
            : undefined
        }
      >
        <div className="mb-3 flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PINK }} />
            <span className="mv-section-title text-sm min-w-0 break-words">
              {activeTab === 'competitor' ? 'Competitor insights' : 'Recent insights'}
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={() => handleIngestAll(false)} disabled={isIngesting} title="Start background data sync (then use Refresh from Database)">
            <RefreshCw className={`h-3 w-3 mr-1 ${isIngesting ? 'animate-spin' : ''}`} /> Sync
          </Button>
        </div>
        {activeTab === 'competitor' && (
          <div className="mv-section-sub mb-3">
            Asurion &amp; Allstate only · Reddit + BBB
          </div>
        )}
        <div className="space-y-3 text-sm">
          { (activeTab === 'competitor' ? competitorInsights : recentInsights).length === 0 && (
            <div className="mv-inset p-4 text-[var(--muted-foreground)] text-xs leading-relaxed">
              No data in current filter.<br />
              {isSupabaseConfigured
                ? 'Data is populated by the background cron job (or the "Sync" button).'
                : 'Supabase keys are placeholders in .env.local — fix and restart.'}
            </div>
          )}
          {(activeTab === 'competitor' ? competitorInsights : recentInsights)
            .map((m) => {
              const src = (m.source || '').toLowerCase();
              const sourceLabel = formatMentionSourceLabel(m.source);
              let sourceColor = GRAY;
              if (src.includes('reddit')) {
                sourceColor = PURPLE;
              } else if (src.includes('trustpilot')) {
                sourceColor = CYAN;
              } else if (src.includes('pissedconsumer') || src.includes('pissed')) {
                sourceColor = PINK;
              } else if (src.includes('app') || src.includes('apple') || src.includes('store')) {
                sourceColor = PINK;
              } else if (src.includes('bbb')) {
                sourceColor = '#A78BFA';
              }

              // Competitor cards always surface brand (Asurion / Allstate), never Likewize
              const brand =
                activeTab === 'competitor'
                  ? (m.company === 'Allstate'
                      ? 'Allstate'
                      : m.company === 'Asurion' || String(m.id || '').includes('2131781')
                        ? 'Asurion'
                        : m.company && m.company !== 'Likewize'
                          ? m.company
                          : null)
                  : null;
              const brandColor =
                brand === 'Asurion' ? PINK : brand === 'Allstate' ? CYAN : GRAY;
              const handle =
                activeTab === 'competitor'
                  ? (m.subreddit ? `r/${m.subreddit}` : null)
                  : (m.subreddit ? `r/${m.subreddit}` : m.client || '');

              const timeAgo = formatMentionTimeAgo(m.created_at);

              return (
                <div
                  key={mentionDedupKey(m)}
                  onClick={() => setSelectedInsight(m)}
                  className="mv-card mv-card-hover p-4 cursor-pointer group min-w-0 overflow-hidden"
                  title="Click for full review / thread + details"
                >
                  {/* Top row: Source + time */}
                  <div className="flex items-center justify-between text-xs gap-2 min-w-0">
                    <span className="font-semibold tracking-wide min-w-0 break-words" style={{ color: sourceColor }}>{sourceLabel}</span>
                    <span className="text-[var(--muted-foreground)] tabular-nums shrink-0">{timeAgo}</span>
                  </div>

                  {/* Brand (Asurion / Allstate) for competitor tab */}
                  {brand && (
                    <div
                      className="mt-1.5 inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full max-w-full"
                      style={{ backgroundColor: `${brandColor}18`, color: brandColor }}
                    >
                      {brand}
                    </div>
                  )}

                  {/* Handle / subreddit */}
                  {handle && (
                    <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5 break-words">
                      {handle}
                    </div>
                  )}

                  {/* Main text */}
                  <p className="mt-2 text-sm leading-snug text-[var(--foreground)] line-clamp-3 break-words">
                    {m.text}
                  </p>

                  {/* Bottom: company already shown · sentiment pill */}
                  <div className="mt-3 flex justify-end">
                    <div
                      className={`mv-pill ${
                        m.sentiment === 'positive' ? 'mv-pill-pos' :
                        m.sentiment === 'negative' ? 'mv-pill-neg' :
                        'mv-pill-neu'
                      }`}
                    >
                      {m.sentiment}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </aside>
        </div>{/* end dashboard + insights row */}
      </div>{/* end main column */}

      <AlertEnrollment
        open={alertEnrollOpen}
        onClose={() => setAlertEnrollOpen(false)}
        clientOptions={clientOptions.map((c) => c.name)}
      />

      {/* Theme drill-down — click a pain / love row to open matching threads */}
      {themeDrill && (
        <div
          className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-[2px] flex"
          onClick={() => setThemeDrill(null)}
        >
          <div
            className="ml-auto w-full max-w-xl bg-[var(--card)] h-full overflow-auto shadow-2xl border-l border-[var(--border)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4 gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-widest text-[var(--muted-foreground)]">
                  {themeDrill.polarity === 'pain' ? 'Pain point threads' : 'What customers love'}
                </div>
                <div className="text-xl font-semibold mt-1 tracking-tight text-[var(--foreground)]">
                  {themeDrill.label}
                </div>
                <div className="text-sm text-[var(--muted-foreground)] mt-1 leading-snug">
                  {themeDrill.insight}
                </div>
                <div className="text-xs text-[var(--muted-foreground)] mt-2">
                  {themeDrill.threads.length} thread{themeDrill.threads.length === 1 ? '' : 's'}
                  {' · '}
                  {themeDrill.businessLineLabel}
                  {' · '}
                  {themeDrill.pct}% of{' '}
                  {themeDrill.polarity === 'pain' ? 'negative' : 'positive'} mentions
                  {activeBusinessLine !== 'All'
                    ? ` · filter: ${formatBusinessLine(activeBusinessLine)}`
                    : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setThemeDrill(null)}
                className="text-2xl leading-none text-[var(--muted-foreground)] hover:text-[var(--foreground)] shrink-0"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {themeDrill.threads.length === 0 ? (
              <div className="mv-empty py-10">No matching threads in this window.</div>
            ) : (
              <ul className="space-y-2.5">
                {themeDrill.threads.map((m) => {
                  const title =
                    (m.title && m.title.trim()) ||
                    (m.text || '').trim().slice(0, 120) ||
                    'Thread';
                  const line = formatBusinessLine(
                    m.business_line || detectBusinessLine(m as any),
                  );
                  return (
                    <li key={mentionDedupKey(m)}>
                      <div className="mv-inset-interactive p-3.5">
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => setSelectedInsight(m)}
                        >
                          <div className="flex items-start justify-between gap-2 text-xs text-[var(--muted-foreground)]">
                            <span className="font-medium text-[var(--foreground)] truncate">
                              {formatMentionSourceLabel(m.source)}
                              {m.subreddit ? ` · r/${m.subreddit}` : ''}
                              {line ? ` · ${line}` : ''}
                            </span>
                            <span className="shrink-0 tabular-nums">
                              {new Date(m.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="mt-1.5 text-sm font-medium text-[var(--foreground)] line-clamp-2 leading-snug">
                            {title}
                          </p>
                          <p className="mt-1 text-xs text-[var(--muted-foreground)] line-clamp-2 leading-snug">
                            {(m.text || '').trim()}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span
                              className={`mv-pill ${
                                m.sentiment === 'positive'
                                  ? 'mv-pill-pos'
                                  : m.sentiment === 'negative'
                                    ? 'mv-pill-neg'
                                    : 'mv-pill-neu'
                              }`}
                            >
                              {m.sentiment}
                            </span>
                            <span className="text-[10px] text-[var(--muted-foreground)]">
                              {m.pillar}
                            </span>
                          </div>
                        </button>
                        <div className="mt-2.5 flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => setSelectedInsight(m)}
                          >
                            View details
                          </Button>
                          {m.url && (
                            <Button
                              size="sm"
                              className="h-7 text-xs button-primary text-white"
                              onClick={() =>
                                window.open(m.url, '_blank', 'noopener,noreferrer')
                              }
                            >
                              Open source
                            </Button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Asurion_Sam replied threads — click metric box to open */}
      {showAsurionSamThreads && (
        <div
          className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-[2px] flex"
          onClick={() => setShowAsurionSamThreads(false)}
        >
          <div
            className="ml-auto w-full max-w-xl bg-[var(--card)] h-full overflow-auto shadow-2xl border-l border-[var(--border)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4 gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-widest text-[var(--muted-foreground)]">
                  Official support replies
                </div>
                <div className="text-xl font-semibold mt-1 tracking-tight text-[var(--foreground)]">
                  Threads with u/Asurion_Sam
                </div>
                <div className="text-sm text-[var(--muted-foreground)] mt-1">
                  {asurionSupport.repliedThreads.length} Reddit thread
                  {asurionSupport.repliedThreads.length === 1 ? '' : 's'} in the current date range
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAsurionSamThreads(false)}
                className="text-2xl leading-none text-[var(--muted-foreground)] hover:text-[var(--foreground)] shrink-0"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {asurionSupport.repliedThreads.length === 0 ? (
              <div className="mv-empty py-10">No threads with an Asurion_Sam reply in this window.</div>
            ) : (
              <ul className="space-y-2.5">
                {asurionSupport.repliedThreads.map((m) => {
                  const title =
                    (m.title && m.title.trim()) ||
                    (m.text || '').trim().slice(0, 120) ||
                    'Reddit thread';
                  const sub = m.subreddit ? `r/${m.subreddit}` : 'Reddit';
                  const hours =
                    typeof (m as { replyHours?: number | null }).replyHours === 'number'
                      ? (m as { replyHours: number }).replyHours
                      : null;
                  return (
                    <li key={mentionDedupKey(m)}>
                      <div className="mv-inset-interactive p-3.5">
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => setSelectedInsight(m)}
                        >
                          <div className="flex items-start justify-between gap-2 text-xs text-[var(--muted-foreground)]">
                            <span className="font-medium text-[var(--foreground)] truncate">
                              {sub}
                            </span>
                            <span className="shrink-0 tabular-nums">
                              {new Date(m.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="mt-1.5 text-sm font-medium text-[var(--foreground)] line-clamp-2 leading-snug">
                            {title}
                          </p>
                          <p className="mt-1 text-xs text-[var(--muted-foreground)] line-clamp-2 leading-snug">
                            {(m.text || '').trim()}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span
                              className={`mv-pill ${
                                m.sentiment === 'positive'
                                  ? 'mv-pill-pos'
                                  : m.sentiment === 'negative'
                                    ? 'mv-pill-neg'
                                    : 'mv-pill-neu'
                              }`}
                            >
                              {m.sentiment}
                            </span>
                            <span className="text-[10px] text-[var(--muted-foreground)]">
                              {m.pillar}
                            </span>
                            {hours != null && (
                              <span className="text-[10px] font-medium text-[var(--primary)] tabular-nums">
                                Sam replied in {hours < 1 ? `${Math.round(hours * 60)}m` : `${hours}h`}
                              </span>
                            )}
                          </div>
                        </button>
                        <div className="mt-2.5 flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => setSelectedInsight(m)}
                          >
                            View details
                          </Button>
                          {m.url && (
                            <Button
                              size="sm"
                              className="h-7 text-xs button-primary text-white"
                              onClick={() => window.open(m.url, '_blank', 'noopener,noreferrer')}
                            >
                              Open on Reddit
                            </Button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Clickable Full Insight Side Panel / Modal (full thread text, client, source, date, tags, link) */}
      {selectedInsight && (() => {
        const whyReasons: HighlightReason[] = getInsightHighlightReasons(selectedInsight, {
          activeClient,
          activeBusinessLine,
          drillPillar,
          activeTab,
        });
        const bodyText = selectedInsight.full_thread || selectedInsight.text || '';
        const titleText = selectedInsight.title || '';
        const titleSegments = segmentHighlightedText(titleText, whyReasons);
        const bodySegments = segmentHighlightedText(bodyText, whyReasons);
        const activeFilterSummary = [
          activeClient !== 'All' ? `Client: ${activeClient}` : null,
          activeTab === 'overview' && activeBusinessLine !== 'All'
            ? `Business line: ${formatBusinessLine(activeBusinessLine)}`
            : null,
          drillPillar ? `Pillar: ${drillPillar}` : null,
        ].filter(Boolean) as string[];

        const renderSegments = (segments: ReturnType<typeof segmentHighlightedText>) =>
          segments.map((seg, i) =>
            seg.markClass ? (
              <mark key={i} className={seg.markClass} title={seg.reasonId}>
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          );

        return (
        <div className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-[2px] flex" onClick={() => setSelectedInsight(null)}>
          <div className="ml-auto w-full max-w-lg bg-[var(--card)] h-full overflow-auto shadow-2xl border-l border-[var(--border)] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-xs uppercase tracking-widest text-[var(--muted-foreground)]">Full review / thread</div>
                <div className="text-xl font-semibold mt-1 tracking-tight text-[var(--foreground)]">
                  {formatMentionSourceLabel(selectedInsight.source)}{selectedInsight.client ? ` · ${selectedInsight.client}` : ''}
                  {selectedInsight.subreddit ? ` · r/${selectedInsight.subreddit}` : ''}
                </div>
              </div>
              <button onClick={() => setSelectedInsight(null)} className="text-2xl leading-none text-[var(--muted-foreground)] hover:text-[var(--foreground)]">×</button>
            </div>

            <div className="flex items-center gap-2 text-sm mb-4 flex-wrap">
              <span className="text-[var(--muted-foreground)]">{new Date(selectedInsight.created_at).toLocaleString()}</span>
              <span
                className={`mv-pill ${
                  selectedInsight.sentiment === 'positive' ? 'mv-pill-pos' :
                  selectedInsight.sentiment === 'negative' ? 'mv-pill-neg' :
                  'mv-pill-neu'
                }`}
              >
                {selectedInsight.sentiment} · {selectedInsight.pillar}
              </span>
              {selectedInsight.rating != null && (
                <span className="mv-chip text-xs px-1.5 py-0.5 text-[var(--muted-foreground)]">{selectedInsight.rating}★</span>
              )}
              {selectedInsight.has_official_reply && /asurion[_-]?sam/i.test(String(selectedInsight.official_replier || 'asurion_sam')) && (
                <span className="mv-chip text-xs px-1.5 py-0.5 text-[var(--primary)] border border-[var(--lw-primary)]/20 bg-[var(--lw-primary-soft)]">
                  u/Asurion_Sam replied
                  {typeof selectedInsight.first_official_reply_hours === 'number'
                    ? ` · ${selectedInsight.first_official_reply_hours < 1
                        ? `${Math.round(selectedInsight.first_official_reply_hours * 60)}m`
                        : `${selectedInsight.first_official_reply_hours}h`}`
                    : ''}
                </span>
              )}
            </div>

            {/* Why this thread is here + stars in the same header; feedback box opens after rating */}
            <ThreadFeedback
              mention={selectedInsight}
              whyReasons={whyReasons}
              activeClient={activeClient}
              activeBusinessLine={activeBusinessLine}
              drillPillar={drillPillar}
              activeTab={activeTab}
              whyContent={
                whyReasons.length > 0 ? (
                  <>
                    <div className="mv-why-chips">
                      {whyReasons.map((r) => (
                        <span
                          key={r.id}
                          className={`mv-hl-chip ${r.chipClass}`}
                          title={r.detail || r.label}
                        >
                          {r.label}
                          {r.terms.length > 0 && (
                            <span className="opacity-70 font-medium">
                              · {r.terms.slice(0, 2).join(', ')}
                              {r.terms.length > 2 ? '…' : ''}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                    {activeFilterSummary.length > 0 ? (
                      <div className="mv-why-detail">
                        Active filters: {activeFilterSummary.join(' · ')}. Matching words are
                        highlighted in the thread below.
                      </div>
                    ) : (
                      <div className="mv-why-detail">
                        Matching brand / pillar / channel words are highlighted below so you can
                        see why it was included.
                      </div>
                    )}
                    {whyReasons.some(
                      (r) =>
                        r.id === 'brand-likewize' && r.terms.some((t) => /likewise/i.test(t)),
                    ) && (
                      <div className="mv-why-detail" style={{ color: '#9a6700' }}>
                        Note: “likewise” can be the English word (or a typo), not always the
                        Likewize brand.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mv-why-detail">
                    Tap stars to rate how useful this thread is for the team.
                  </div>
                )
              }
            />

            {titleText && (
              <div className="font-medium mb-2 mt-4 text-[var(--foreground)] mv-thread-body">
                {renderSegments(titleSegments)}
              </div>
            )}

            <div className={`prose prose-sm max-w-none whitespace-pre-wrap text-[var(--foreground)] mv-inset p-4 mv-thread-body ${!titleText ? 'mt-4' : ''}`}>
              {renderSegments(bodySegments)}
            </div>

            {selectedInsight.key_issue && (
              <div className="mt-4 text-sm">
                <span className="font-medium text-[var(--muted-foreground)]">Key issue:</span> {selectedInsight.key_issue}
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <Button
                onClick={() => window.open(selectedInsight.url, '_blank')}
                className="button-primary text-white"
              >
                Open original source
              </Button>
              <Button variant="outline" onClick={() => setSelectedInsight(null)}>
                Close
              </Button>
            </div>

            <div className="mt-8 text-[10px] text-[var(--muted-foreground)]">
              ID: {selectedInsight.id} • Confidence: {((selectedInsight.confidence || 0.8) * 100).toFixed(0)}%
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
