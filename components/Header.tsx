"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Bell, RefreshCw } from "lucide-react";

const timeRanges = ["7d", "30d", "90d", "All"] as const;

export function Header() {
  const [activeRange, setActiveRange] = useState<(typeof timeRanges)[number]>("30d");
  const [query, setQuery] = useState("");

  const handleExport = () => {
    // In Phase 3+ this will export current filtered aggregates
    const csvContent = "data:text/csv;charset=utf-8,Market Vantage Export\nHealth Score,72\nPositive,63%\n...";
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = `market-vantage-${activeRange}.csv`;
    link.click();
  };

  return (
    <header className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur dark:bg-[#0f172a]/95">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600 text-white font-bold text-lg">MI</div>
            <div>
              <div className="font-semibold text-xl tracking-tight">Market Vantage</div>
            </div>
          </div>

          <div className="flex-1 max-w-md">
            <Input
              placeholder="Search pain points or mentions..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="flex items-center gap-2">
            {/* Time range filters */}
            <div className="flex items-center rounded-lg border bg-muted p-0.5 text-sm">
              {timeRanges.map((range) => (
                <button
                  key={range}
                  onClick={() => setActiveRange(range)}
                  className={`px-3 py-1 rounded-md transition font-medium ${
                    activeRange === range
                      ? "bg-[#3200BE] text-white shadow"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/70"
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>

            <Button onClick={handleExport} className="gap-2 button-primary" size="sm">
              <Download className="h-4 w-4" />
              Export
            </Button>

            <Button variant="outline" size="icon" className="h-9 w-9">
              <RefreshCw className="h-4 w-4" />
            </Button>

            <Button variant="outline" size="icon" className="h-9 w-9 relative">
              <Bell className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="pb-4">
          <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
        </div>
      </div>
    </header>
  );
}
