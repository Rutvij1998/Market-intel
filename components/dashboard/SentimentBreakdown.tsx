"use client";

interface BreakdownProps {
  data: {
    positive: number;
    neutral: number;
    negative: number;
  };
}

export function SentimentBreakdown({ data }: BreakdownProps) {
  const items = [
    { label: "Positive", value: data.positive, color: "bg-[#22C55E]", text: "text-[#22C55E]" },
    { label: "Neutral", value: data.neutral, color: "bg-[#64748B]", text: "text-[#64748B]" },
    { label: "Negative", value: data.negative, color: "bg-[#EF4444]", text: "text-[#EF4444]" },
  ];

  return (
    <div className="grid grid-cols-3 gap-4">
      {items.map((item, idx) => (
        <div key={idx} className="flex flex-col items-center justify-center rounded-xl border p-5 text-center">
          <div className={`text-5xl font-semibold tabular-nums tracking-tight ${item.text}`}>
            {item.value}%
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${item.color}`} />
            <span className="text-sm font-medium text-muted-foreground">{item.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
