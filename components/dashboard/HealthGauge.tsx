"use client";

import { useState, useEffect, useRef } from "react";

interface HealthGaugeProps {
  score: number; // 0-100
}

export function HealthGauge({ score }: HealthGaugeProps) {
  const normalized = Math.max(0, Math.min(100, score));

  // Animate the number counting up (loading animation to the target score, e.g. 44)
  const [displayScore, setDisplayScore] = useState(0);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const target = Math.round(score);
    if (displayScore === target) return;

    const duration = 900; // ms for smooth load-up
    const start = displayScore;
    const startTime = performance.now();

    // Cancel any previous animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    const animate = (time: number) => {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const value = Math.floor(start + (target - start) * progress);
      setDisplayScore(value);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayScore(target);
        animationRef.current = null;
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [score]);

  // Accurate arc length for the semicircular path (r=105, 180deg)
  const ARC_LENGTH = 105 * Math.PI; // ~329.87

  return (
    <div className="gauge-container flex flex-col items-center">
      <div className="relative w-[300px] h-[170px]">
        {/* Background track - soft lavender */}
        <svg width="300" height="170" className="absolute">
          <path
            d="M 45 140 A 105 105 0 0 1 255 140"
            fill="none"
            stroke="#EDE5FF"
            strokeWidth="30"
            strokeLinecap="round"
          />
        </svg>

        {/* Main Arc - Vibrant Purple, red for low scores. Bound dynamically via dashoffset for exact % from left to right */}
        <svg width="300" height="170" className="absolute">
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={normalized < 40 ? "#E11D48" : "#3200BE"} />
              <stop offset="100%" stopColor={normalized < 40 ? "#E11D48" : "#FF96FF"} />
            </linearGradient>
          </defs>
          <path
            d="M 45 140 A 105 105 0 0 1 255 140"
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth="28"
            strokeLinecap="round"
            strokeDasharray={ARC_LENGTH}
            strokeDashoffset={ARC_LENGTH * (1 - normalized / 100)}
            style={{ transition: "stroke-dashoffset 0.25s ease-out" }}
          />
        </svg>

        {/* Center content - number nicely placed in the center of the purple arc */}
        <div className="absolute left-1/2 top-[70px] -translate-x-1/2 flex flex-col items-center">
          <div 
            className="text-[82px] font-extrabold leading-none tracking-[-3.5px] tabular-nums transition-all duration-300"
            style={{ color: "var(--foreground)" }}
          >
            {displayScore}
          </div>
          <div className="text-[11px] tracking-wider uppercase text-[var(--muted-foreground)] mt-0.5">
            Health score
          </div>
        </div>
      </div>
    </div>
  );
}
