"use client";

import { useState, useCallback, useRef } from "react";
import type { LogLine, RunRequest } from "@/types/pipeline";

interface UseSSEResult {
  logs: LogLine[];
  isRunning: boolean;
  exitCode: number | null;
  error: string | null;
  run: (request: RunRequest) => void;
  clear: () => void;
}

export function useSSE(): UseSSEResult {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    setLogs([]);
    setExitCode(null);
    setError(null);
  }, []);

  const run = useCallback((request: RunRequest) => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setLogs([]);
    setExitCode(null);
    setError(null);
    setIsRunning(true);

    fetch("/api/pipeline/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const block of lines) {
            if (!block.trim()) continue;

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

              if (eventType === "log") {
                setLogs((prev) => [
                  ...prev,
                  {
                    stream: parsed.stream,
                    line: parsed.line,
                    ts: parsed.ts,
                  },
                ]);
              } else if (eventType === "done") {
                setExitCode(parsed.exitCode);
                setIsRunning(false);
              } else if (eventType === "error") {
                setError(parsed.message);
                setIsRunning(false);
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError(err.message);
        setIsRunning(false);
      });
  }, []);

  return { logs, isRunning, exitCode, error, run, clear };
}
