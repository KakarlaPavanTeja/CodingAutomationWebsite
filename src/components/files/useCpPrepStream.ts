"use client";

import { useCallback, useRef, useState } from "react";
import type { PrepInput, PrepResult } from "@/lib/cp-prep/types";

export interface CpPrepLogLine {
  type: "status" | "warning" | "error";
  message: string;
  ts: number;
}

interface UseCpPrepStreamResult {
  logs: CpPrepLogLine[];
  isRunning: boolean;
  result: PrepResult | null;
  error: string | null;
  generate: (input: PrepInput) => void;
  abort: () => void;
  clear: () => void;
}

export function useCpPrepStream(): UseCpPrepStreamResult {
  const [logs, setLogs] = useState<CpPrepLogLine[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<PrepResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    setLogs([]);
    setResult(null);
    setError(null);
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
  }, []);

  const generate = useCallback((input: PrepInput) => {
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    setLogs([]);
    setResult(null);
    setError(null);
    setIsRunning(true);

    fetch("/api/cp-prep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const text = await response.text();
          let message = text || `HTTP ${response.status}`;
          try {
            const parsed = JSON.parse(text);
            if (parsed.error) message = parsed.error;
          } catch {
            /* use raw text */
          }
          throw new Error(message);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() || "";

          for (const block of blocks) {
            if (!block.trim() || block.trim().startsWith(":")) continue;

            let eventType = "message";
            let data = "";

            for (const line of block.split("\n")) {
              if (line.startsWith("event: ")) {
                eventType = line.slice(7);
              } else if (line.startsWith("data: ")) {
                data = line.slice(6);
              }
            }

            if (!data) continue;

            try {
              const parsed = JSON.parse(data);
              const ts = Date.now();

              if (eventType === "status" || eventType === "warning") {
                setLogs((prev) => [
                  ...prev,
                  { type: eventType, message: parsed.message ?? String(parsed), ts },
                ]);
              } else if (eventType === "done") {
                setResult(parsed as PrepResult);
                setIsRunning(false);
              } else if (eventType === "error") {
                setError(parsed.message ?? "Generation failed");
                setLogs((prev) => [
                  ...prev,
                  { type: "error", message: parsed.message ?? "Generation failed", ts },
                ]);
                setIsRunning(false);
              }
            } catch {
              /* skip malformed JSON */
            }
          }
        }

        setIsRunning(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError(err.message);
        setIsRunning(false);
      });
  }, []);

  return { logs, isRunning, result, error, generate, abort, clear };
}
