"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { OutputBrowser } from "@/components/files/OutputBrowser";
import { TabbedEditor } from "@/components/files/TabbedEditor";
import type { OutputFile } from "@/types/pipeline";

const CODING_QUESTIONS_PATH = "forJSONPreparation/coding_questions.json";

export interface OpenTab {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  language: string;
  editing: boolean;
  loading: boolean;
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  py: "python",
  cpp: "cpp",
  java: "java",
  js: "javascript",
  json: "json",
  md: "markdown",
  lua: "lua",
  txt: "text",
  h: "cpp",
};

interface ProblemOutputsProps {
  problemId: string;
}

export function ProblemOutputs({ problemId }: ProblemOutputsProps) {
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [hasCodingQuestions, setHasCodingQuestions] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/files/outputs?problemId=${encodeURIComponent(problemId)}`
        );
        const data = await res.json();
        if (cancelled) return;
        const exists = (data.files || []).some(
          (f: OutputFile) => !f.isDirectory && f.path === CODING_QUESTIONS_PATH
        );
        setHasCodingQuestions(exists);
      } catch {
        if (!cancelled) setHasCodingQuestions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [problemId]);

  const openFile = useCallback(
    async (path: string) => {
      const existing = openTabs.find((t) => t.path === path);
      if (existing) {
        setActiveTabPath(path);
        return;
      }

      const name = path.split("/").pop() || path;
      const ext = name.split(".").pop() || "";
      const language = EXT_TO_LANGUAGE[ext] || "text";

      const newTab: OpenTab = {
        path,
        name,
        content: "",
        originalContent: "",
        language,
        editing: false,
        loading: true,
      };
      setOpenTabs((prev) => [...prev, newTab]);
      setActiveTabPath(path);

      try {
        const res = await fetch(
          `/api/files/read?path=${encodeURIComponent(path)}&problemId=${encodeURIComponent(problemId)}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setOpenTabs((prev) =>
          prev.map((t) =>
            t.path === path
              ? { ...t, content: data.content, originalContent: data.content, loading: false }
              : t
          )
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Failed to load";
        setOpenTabs((prev) =>
          prev.map((t) =>
            t.path === path
              ? { ...t, content: `Error: ${errMsg}`, originalContent: "", loading: false }
              : t
          )
        );
      }
    },
    [openTabs, problemId]
  );

  const closeTab = useCallback(
    (path: string) => {
      // Compute the next active tab BEFORE updating state — calling setState
      // inside a setOpenTabs updater is impure and double-fires in StrictMode
      // (UI-M2).
      const idx = openTabs.findIndex((t) => t.path === path);
      const filtered = openTabs.filter((t) => t.path !== path);
      if (activeTabPath === path) {
        const nextTab = filtered[Math.min(idx, filtered.length - 1)];
        setActiveTabPath(nextTab?.path || null);
      }
      setOpenTabs(filtered);
    },
    [openTabs, activeTabPath]
  );

  const updateTab = useCallback((path: string, updates: Partial<OpenTab>) => {
    setOpenTabs((prev) => prev.map((t) => (t.path === path ? { ...t, ...updates } : t)));
  }, []);

  const saveTab = useCallback(
    async (path: string) => {
      const tab = openTabs.find((t) => t.path === path);
      if (!tab) return;

      try {
        const res = await fetch("/api/files/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, content: tab.content, problemId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        updateTab(path, { originalContent: tab.content, editing: false });
        return true;
      } catch {
        return false;
      }
    },
    [openTabs, updateTab, problemId]
  );

  const openPaths = useMemo(() => new Set(openTabs.map((t) => t.path)), [openTabs]);

  return (
    <div className="flex flex-col gap-3">
      {hasCodingQuestions && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              Upload-ready question file
            </p>
            <p className="text-xs text-muted-foreground truncate">
              coding_questions.json — ready to upload to the coding platform
            </p>
          </div>
          <a
            href={`/api/files/download?problemId=${encodeURIComponent(problemId)}&path=${encodeURIComponent(CODING_QUESTIONS_PATH)}`}
            download
            className="inline-flex items-center gap-1.5 shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
            Download
          </a>
        </div>
      )}

      <div className="flex border rounded-lg overflow-hidden" style={{ height: "calc(100vh - 280px)" }}>
      {/* Sidebar */}
      <div className="w-60 border-r bg-card flex flex-col shrink-0">
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Outputs by stage
          </span>
          <a
            href={`/api/files/download?problemId=${encodeURIComponent(problemId)}`}
            title="Download all outputs as ZIP"
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
          </a>
        </div>
        <div className="flex-1 overflow-auto">
          <OutputBrowser
            selectedPath={activeTabPath}
            openPaths={openPaths}
            onSelectFile={openFile}
            problemId={problemId}
          />
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        <TabbedEditor
          tabs={openTabs}
          activeTabPath={activeTabPath}
          onSelectTab={setActiveTabPath}
          onCloseTab={closeTab}
          onUpdateTab={updateTab}
          onSaveTab={saveTab}
        />
      </div>
      </div>
    </div>
  );
}
