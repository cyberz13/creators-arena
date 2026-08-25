"use client";

import { useEffect, useState } from "react";

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

/**
 * Animated number ramp. Starts immediately (design behavior); pass
 * startInView for below-the-fold counters like the stats band.
 */
export function CountUp({
  value,
  duration = 1400,
  decimals = 0,
  startInView = false,
  className,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  startInView?: boolean;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const [el, setEl] = useState<HTMLSpanElement | null>(null);

  useEffect(() => {
    let raf = 0;
    let stopped = false;
    let fired = false;

    let settle = 0;
    const start = () => {
      if (fired || stopped) return;
      fired = true;
      const t0 = performance.now();
      const tick = (t: number) => {
        if (stopped) return;
        const p = Math.min(1, (t - t0) / duration);
        setDisplay(value * easeOut(p));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      // Background tabs freeze rAF entirely — make sure the final value lands anyway.
      settle = window.setTimeout(() => {
        if (!stopped) setDisplay(value);
      }, duration + 600);
    };

    if (!startInView || !el) {
      start();
      return () => {
        stopped = true;
        cancelAnimationFrame(raf);
        clearTimeout(settle);
      };
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      },
      { threshold: 0.3 }
    );
    io.observe(el);
    const fallback = setTimeout(start, 3000);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      clearTimeout(fallback);
      clearTimeout(settle);
    };
  }, [value, duration, startInView, el]);

  const text =
    decimals > 0 ? display.toFixed(decimals) : Math.round(display).toLocaleString("en-US");
  return (
    <span ref={setEl} className={`num ${className ?? ""}`}>
      {text}
    </span>
  );
}
