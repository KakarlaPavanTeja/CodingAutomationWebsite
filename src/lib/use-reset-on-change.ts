"use client";

import { useState } from "react";

/**
 * Run `reset` during render whenever `key` changes.
 *
 * React's sanctioned "adjusting state when a prop changes" pattern. It replaces the
 * `useEffect(() => setX(...), [key])` shape that `react-hooks/set-state-in-effect`
 * rejects — and the effect version is genuinely worse: it commits a render with the
 * STALE state, then immediately re-renders, so consumers briefly show the previous
 * step's logs or the previous selection's tab.
 *
 * `key` must be a primitive — build one with a template string for compound keys.
 * `seen` starts at `null` rather than at `key`, which reproduces the mount behaviour of
 * the effects this replaced: a non-null key on the first render still fires once.
 */
export function useResetOnChange(key: string | null, reset: () => void): void {
  const [seen, setSeen] = useState<string | null>(null);
  if (seen !== key) {
    setSeen(key);
    reset();
  }
}
