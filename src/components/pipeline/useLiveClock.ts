"use client";

import { useEffect, useState } from "react";

/** Returns current timestamp updated every second while `active` is true. */
export function useLiveClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  return now;
}

export function liveDurationSec(
  startTime: number | null | undefined,
  endTime: number | null | undefined,
  status: string,
  now: number
): number | null {
  if (!startTime) return null;
  const end = endTime ?? (status === "running" ? now : null);
  return end ? Math.floor((end - startTime) / 1000) : null;
}
