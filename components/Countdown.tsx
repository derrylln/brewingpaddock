"use client";

import { useEffect, useState } from "react";

function pad(n: number): string {
  return String(Math.max(0, n)).padStart(2, "0");
}

export default function Countdown({ date }: { date: string }) {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const target = new Date(`${date}T12:00:00Z`).getTime();
    const tick = () => setLeft(target - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [date]);

  const total = left ?? 0;
  const days = Math.floor(total / 86400000);
  const hours = Math.floor((total % 86400000) / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);

  return (
    <div className="countdown" aria-live="off">
      <div className="countdown-cell">
        <span className="countdown-value mono">{left === null ? "--" : pad(days)}</span>
        <span className="countdown-label mono">days</span>
      </div>
      <span className="countdown-sep">:</span>
      <div className="countdown-cell">
        <span className="countdown-value mono">{left === null ? "--" : pad(hours)}</span>
        <span className="countdown-label mono">hrs</span>
      </div>
      <span className="countdown-sep">:</span>
      <div className="countdown-cell">
        <span className="countdown-value mono">{left === null ? "--" : pad(minutes)}</span>
        <span className="countdown-label mono">min</span>
      </div>
      <span className="countdown-sep">:</span>
      <div className="countdown-cell">
        <span className="countdown-value mono">{left === null ? "--" : pad(seconds)}</span>
        <span className="countdown-label mono">sec</span>
      </div>
    </div>
  );
}
