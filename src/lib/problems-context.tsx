"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "./auth-context";

export type Problem = {
  id: string;
  name: string;
  question_type: string;
  mode: string;
  scenario_level?: string;
  status: string;
  languages?: string[];
  created_at: string;
  updated_at?: string;
  deletion_reason?: string | null;
  storage_path?: string | null;
  created_by?: string;
  profiles?: { display_name: string | null; email: string } | null;
};

type Ctx = {
  problems: Problem[];
  loading: boolean;
  error: string | null;
  /** Force-fetch the latest problems list from the server. */
  refresh: () => Promise<void>;
  /** Optimistically remove a problem from the cached list (for delete flows). */
  removeLocally: (id: string) => void;
  /** Optimistically replace one problem (for inline status updates). */
  upsertLocally: (problem: Problem) => void;
};

const ProblemsContext = createContext<Ctx>({
  problems: [],
  loading: false,
  error: null,
  refresh: async () => {},
  removeLocally: () => {},
  upsertLocally: () => {},
});

// How long a fetched list is considered "fresh" — re-mounts within this window
// reuse the cache instead of hitting the API.
const STALE_MS = 15_000;

export function ProblemsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedRef = useRef(0);
  const inflightRef = useRef<Promise<void> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Generation counter — bumped on every auth change. Any in-flight fetch
  // started before the bump will discard its response.
  const generationRef = useRef(0);
  // Track the user id the cache currently belongs to.
  const cachedUserIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (inflightRef.current) return inflightRef.current;
    const startGeneration = generationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;

    const run = async (): Promise<void> => {
      setLoading(true);
      try {
        const res = await fetch("/api/problems", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (generationRef.current !== startGeneration) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (generationRef.current !== startGeneration) return;
        setProblems((data.problems as Problem[]) || []);
        setError(null);
        lastFetchedRef.current = Date.now();
      } catch (e) {
        if (controller.signal.aborted) return;
        if (generationRef.current !== startGeneration) return;
        setError(e instanceof Error ? e.message : "Failed to load problems");
      } finally {
        if (generationRef.current === startGeneration) {
          setLoading(false);
        }
        if (abortRef.current === controller) abortRef.current = null;
      }
    };
    const p = run().finally(() => {
      if (inflightRef.current === p) inflightRef.current = null;
    });
    inflightRef.current = p;
    return p;
  }, []);

  // Auth transitions: bump generation, abort in-flight, clear cache when the
  // user identity changes. Then fetch fresh data for the new user.
  useEffect(() => {
    const currentUserId = user?.id ?? null;
    if (cachedUserIdRef.current === currentUserId) return;

    // Identity changed (login, logout, or user swap).
    generationRef.current += 1;
    if (abortRef.current) abortRef.current.abort();
    inflightRef.current = null;
    cachedUserIdRef.current = currentUserId;
    lastFetchedRef.current = 0;
    setProblems([]);
    setError(null);
    setLoading(false);

    if (currentUserId) {
      refresh();
    }
  }, [user, refresh]);

  // Abort any in-flight request on unmount.
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const removeLocally = useCallback((id: string) => {
    setProblems((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const upsertLocally = useCallback((problem: Problem) => {
    setProblems((prev) => {
      const idx = prev.findIndex((p) => p.id === problem.id);
      if (idx === -1) return [problem, ...prev];
      const next = prev.slice();
      next[idx] = { ...next[idx], ...problem };
      return next;
    });
  }, []);

  return (
    <ProblemsContext.Provider
      value={{ problems, loading, error, refresh, removeLocally, upsertLocally }}
    >
      {children}
    </ProblemsContext.Provider>
  );
}

export const useProblems = () => useContext(ProblemsContext);

// Note: STALE_MS is reserved for future use (e.g. focus-revalidation gating)
// — the current logic always refetches on identity change and on explicit
// refresh() calls, which is the safe default.
void STALE_MS;
