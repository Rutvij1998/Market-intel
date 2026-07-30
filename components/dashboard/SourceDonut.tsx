"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

interface Source {
  name: string;
  value: number;
  color: string;
}

export function SourceDonut({ sources }: { sources: Source[] }) {
  const total = sources.reduce((sum, s) => sum + s.value, 0);

  // Exact colors per user spec for pie
  const coloredSources = sources.map(s => {
    if (s.name.toLowerCase().includes('reddit')) return { ...s, color: '#3200BE' };
    if (s.name.toLowerCase().includes('trustpilot')) return { ...s, color: '#EC4899' };
    return { ...s, color: '#14B8A6' }; // Teal/Cyan for BBB/Google
  });

  return (
    <div className="flex flex-col items-center">
      <div className="h-[200px] w-full">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={coloredSources}
              cx="50%"
              cy="50%"
              innerRadius={58}
              outerRadius={88}
              dataKey="value"
              paddingAngle={2}
            >
              {coloredSources.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: any) => [`${value}%`, "Share"]}
              contentStyle={{
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                fontSize: "12px",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm w-full">
        {coloredSources.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-muted-foreground">{s.name}</span>
            <span className="ml-auto font-medium tabular-nums">{s.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
