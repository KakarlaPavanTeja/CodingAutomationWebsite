"use client";

import { useEffect, useState } from "react";

/** Returns current timestamp updated every second while `active` is true. */
export function useLiveClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    // The immediate catch-up runs on a 0ms timer rather than inline: `now` can be stale by
    // however long the panel sat idle before this step started running, but a synchronous
    // setState here would cascade an extra render on every activation.
    const catchUp = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(catchUp);
      clearInterval(id);
    };
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
