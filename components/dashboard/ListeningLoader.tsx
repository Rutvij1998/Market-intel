"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Star } from "lucide-react";

const BEATS = [
  "Listening for the customer in public",
  "Gathering Reddit, BBB & review threads",
  "Scoring sentiment by journey",
  "Watching Asurion in the same room",
];

const SOURCES = ["Reddit", "BBB", "Reviews"] as const;

const BLIPS = [
  { top: "18%", left: "62%", color: "var(--lw-accent)", delay: "0.2s" },
  { top: "28%", left: "22%", color: "var(--lw-cyan)", delay: "0.9s" },
  { top: "58%", left: "16%", color: "var(--lw-primary)", delay: "1.4s" },
  { top: "68%", left: "72%", color: "var(--lw-accent)", delay: "1.9s" },
  { top: "42%", left: "78%", color: "var(--lw-cyan)", delay: "2.4s" },
  { top: "14%", left: "38%", color: "var(--lw-primary)", delay: "2.9s" },
];

/**
 * First-load overlay while Supabase mentions arrive.
 * Skip for screenshot=1 captures (headless PDF).
 */
export function ListeningLoader({ active }: { active: boolean }) {
  const [shown, setShown] = useState(false);
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    if (!active) {
      setShown(false);
      setBeat(0);
      return;
    }
    const t = window.setTimeout(() => setShown(true), 140);
    return () => window.clearTimeout(t);
  }, [active]);

  useEffect(() => {
    if (!shown) return;
    const id = window.setInterval(() => setBeat((b) => (b + 1) % BEATS.length), 1400);
    return () => window.clearInterval(id);
  }, [shown]);

  useEffect(() => {
    if (!shown || !active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [shown, active]);

  return (
    <AnimatePresence>
      {shown && active ? (
        <motion.div
          className="mv-listen"
          role="status"
          aria-live="polite"
          aria-busy="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mv-listen-wash" aria-hidden />
          <div className="mv-listen-card">
            <div className="mv-listen-radar" aria-hidden>
              <div className="mv-listen-ring" />
              <div className="mv-listen-ring mv-listen-ring--2" />
              <div className="mv-listen-ring mv-listen-ring--3" />
              <div className="mv-listen-sweep" />
              {BLIPS.map((b, i) => (
                <span
                  key={i}
                  className="mv-listen-blip"
                  style={{
                    top: b.top,
                    left: b.left,
                    background: b.color,
                    animationDelay: b.delay,
                  }}
                />
              ))}
              <div className="mv-listen-core">
                <Star className="h-5 w-5 text-white" />
              </div>
            </div>

            <div className="mv-listen-kicker">Market Vantage</div>
            <div className="mv-listen-beat" aria-label={BEATS[beat]}>
              <AnimatePresence mode="wait">
                <motion.p
                  key={beat}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.28 }}
                >
                  {BEATS[beat]}
                </motion.p>
              </AnimatePresence>
            </div>

            <div className="mv-listen-sources">
              {SOURCES.map((label, i) => (
                <span
                  key={label}
                  className={`mv-listen-chip${beat % SOURCES.length === i || beat >= 3 ? " is-on" : ""}`}
                >
                  <i />
                  {label}
                </span>
              ))}
            </div>

            <div className="mv-listen-bar" aria-hidden>
              <span />
            </div>
            <p className="mv-listen-foot">Likewize internal · assembling your briefing</p>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
