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
    { label: "Positive", value: data.positive, color: "bg-[#FF96FF]", text: "text-[#FF96FF]" },
    { label: "Neutral", value: data.neutral, color: "bg-[#00A8B8]", text: "text-[#00A8B8]" },
    { label: "Negative", value: data.negative, color: "bg-[#3200BE]", text: "text-[#3200BE]" },
  ];

  return (
    <div className="grid grid-cols-3 gap-4">
      {items.map((item, idx) => (
        <div key={idx} className="mv-inset flex flex-col items-center justify-center p-5 text-center">
          <div className={`text-5xl font-semibold tabular-nums tracking-tight ${item.text}`}>
            {item.value}%
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${item.color}`} />
            <span className="text-sm font-medium text-[var(--muted-foreground)]">{item.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
