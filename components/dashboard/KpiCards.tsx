"use client";

import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, MessageSquare, Clock, Users } from "lucide-react";

interface KpiData {
  totalMentions: number;
  totalMentionsChange: number;
  positiveTrend: number;
  avgResponseTime: string;
  avgResponseTimeChange: number;
  shareOfVoice: number;
  shareOfVoiceChange: number;
}

export function KpiCards({ data }: { data: KpiData }) {
  const cards = [
    {
      label: "Total Mentions",
      value: data.totalMentions.toLocaleString(),
      change: `+${data.totalMentionsChange}%`,
      changePositive: true,
      icon: MessageSquare,
    },
    {
      label: "Positive Trend",
      value: `+${data.positiveTrend} pts`,
      change: "vs previous period",
      changePositive: true,
      icon: TrendingUp,
    },
    {
      label: "Avg Response Time",
      value: data.avgResponseTime,
      change: `${data.avgResponseTimeChange}m`,
      changePositive: data.avgResponseTimeChange < 0,
      icon: Clock,
    },
    {
      label: "Share of Voice",
      value: `${data.shareOfVoice}%`,
      change: `+${data.shareOfVoiceChange} pts`,
      changePositive: true,
      icon: Users,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <Card key={index} className="mv-kpi border-0 shadow-none">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="mv-kpi-label">{card.label}</div>
                  <div className="mv-kpi-value text-3xl">{card.value}</div>
                </div>
                <div className="rounded-lg bg-[var(--lw-primary-soft)] p-2">
                  <Icon className="h-5 w-5" style={{ color: "var(--lw-primary)" }} />
                </div>
              </div>
              <div className={`mt-3 text-sm font-medium ${card.changePositive ? "text-[var(--lw-cyan)]" : "text-[var(--lw-primary)]"}`}>
                {card.change}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
