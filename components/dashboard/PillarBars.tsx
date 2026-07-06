"use client";

import { useState } from "react";

interface Pillar {
  name: string;
  positive: number;
  neutral: number;
  negative: number;
  mentions: number;
}

interface PillarBarsProps {
  pillars: Pillar[];
}

export function PillarBars({ pillars }: PillarBarsProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      {pillars.map((p) => {
        const total = p.positive + p.neutral + p.negative;
        const posWidth = (p.positive / total) * 100;
        const neuWidth = (p.neutral / total) * 100;
        const negWidth = (p.negative / total) * 100;

        return (
          <div key={p.name} className="group">
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-muted-foreground">
                {p.positive}% positive, {p.mentions.toLocaleString()} mentions
              </div>
            </div>

            {/* Stacked bar */}
            <div
              className="relative h-7 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800 flex"
              onMouseEnter={() => setHovered(p.name)}
              onMouseLeave={() => setHovered(null)}
            >
              <div
                className="h-full transition-all"
                style={{ width: `${posWidth}%`, backgroundColor: "#22C55E" }}
                title={`Positive: ${p.positive}%`}
              />
              <div
                className="h-full transition-all"
                style={{ width: `${neuWidth}%`, backgroundColor: "#64748B" }}
                title={`Neutral: ${p.neutral}%`}
              />
              <div
                className="h-full transition-all"
                style={{ width: `${negWidth}%`, backgroundColor: "#EF4444" }}
                title={`Negative: ${p.negative}%`}
              />
            </div>

            {/* Tooltip on hover */}
            {hovered === p.name && (
              <div className="mt-1 text-xs text-muted-foreground">
                Positive {p.positive}% • Neutral {p.neutral}% • Negative {p.negative}%
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
