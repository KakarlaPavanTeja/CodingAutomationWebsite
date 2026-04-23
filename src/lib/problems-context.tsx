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

export function ProblemsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true); // true until first response
  const [error, setError] = useState<string | null>(null);

  // Generation counter — bumped any time the cache is intentionally invalidated.
  // In-flight fetches from a previous generation silently discard their response.
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const inflightRef = useRef<Promise<void> | null>(null);

  // Tracks the user id whose data is currently in the cache so we can detect
  // session switches (user A → user B) and force a fresh fetch.
  const cachedUserIdRef = useRef<string | null>(null);
  // Set to true when a fetch has returned a 200 response — used to skip the
  // redundant re-fetch when the auth identity resolves after the mount fetch
  // already succeeded (common for pages where the user is already logged in).
  const hasFreshDataRef = useRef(false);

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
        if (!res.ok) {
          // 401 means unauthenticated — clear list, no error shown.
          if (res.status === 401) {
            setProblems([]);
            setError(null);
          } else {
            throw new Error(`HTTP ${res.status}`);
          }
          return;
        }
        const data = await res.json();
        if (generationRef.current !== startGeneration) return;
        setProblems((data.problems as Problem[]) || []);
        setError(null);
        hasFreshDataRef.current = true;
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

  // Eager fetch on first mount — fires immediately, in parallel with the auth
  // session check, so data arrives as fast as possible on first load.
  useEffect(() => {
    refresh();
    return () => {
      // Abort on unmount (e.g. hot-reload)
      generationRef.current += 1;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle auth identity changes AFTER the initial mount:
  // - Logout (user → null): clear cache so the next user starts clean.
  // - User switch (userA → userB): bump generation to discard stale data and
  //   re-fetch for the new identity.
  // - null → user on first load: the eager mount fetch covers this; no action.
  useEffect(() => {
    const currentUserId = user?.id ?? null;
    const prevUserId = cachedUserIdRef.current;

    if (prevUserId === currentUserId) return; // no real change
    cachedUserIdRef.current = currentUserId;

    if (currentUserId === null) {
      // Logged out — abort in-flight, clear cache.
      generationRef.current += 1;
      abortRef.current?.abort();
      inflightRef.current = null;
      hasFreshDataRef.current = false;
      setProblems([]);
      setError(null);
      setLoading(false);
    } else if (prevUserId !== null) {
      // Different user logged in (session switch) — discard and re-fetch.
      generationRef.current += 1;
      abortRef.current?.abort();
      inflightRef.current = null;
      hasFreshDataRef.current = false;
      refresh();
    } else {
      // null → user: normal login. The eager mount fetch ran in parallel — if
      // it already returned data we don't need to fetch again. If it returned
      // 401 (no cookie yet) or is still in-flight, fire/join a refresh.
      if (!hasFreshDataRef.current) {
        refresh();
      }
    }
  }, [user, refresh]);

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
