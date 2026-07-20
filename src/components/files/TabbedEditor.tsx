"use client";

import { useCallback, useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { OpenTab } from "@/app/outputs/page";

interface TabbedEditorProps {
  tabs: OpenTab[];
  activeTabPath: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onUpdateTab: (path: string, updates: Partial<OpenTab>) => void;
  onSaveTab: (path: string) => Promise<boolean | undefined>;
}

export function TabbedEditor({
  tabs,
  activeTabPath,
  onSelectTab,
  onCloseTab,
  onUpdateTab,
  onSaveTab,
}: TabbedEditorProps) {
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  const activeTab = tabs.find((t) => t.path === activeTabPath);

  const handleSave = useCallback(async (path: string) => {
    setSaveStatus((prev) => ({ ...prev, [path]: "saving" }));
    const ok = await onSaveTab(path);
    setSaveStatus((prev) => ({ ...prev, [path]: ok ? "saved" : "error" }));
    setTimeout(() => {
      setSaveStatus((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
    }, 2000);
  }, [onSaveTab]);

  // Keyboard shortcut: Ctrl/Cmd+S to save the active tab
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (activeTabPath && activeTab && activeTab.content !== activeTab.originalContent) {
          handleSave(activeTabPath);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTabPath, activeTab, handleSave]);

  const handleCopy = useCallback(async (path: string) => {
    const tab = tabs.find((t) => t.path === path);
    if (!tab) return;
    const ok = await copyToClipboard(tab.content);
    setSaveStatus((prev) => ({ ...prev, [path]: ok ? "copied" : "error" }));
    setTimeout(() => {
      setSaveStatus((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
    }, 2000);
  }, [tabs]);

  // Empty state
  if (tabs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950/50">
        <div className="text-center space-y-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-muted-foreground/30"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
          <p className="text-muted-foreground text-sm">Select a file from the explorer to open it</p>
          <p className="text-muted-foreground/60 text-xs">You can open multiple files as tabs</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab Bar */}
      <div className="flex items-center border-b bg-card/50 min-h-[35px]">
        <div ref={tabsContainerRef} className="flex items-center overflow-x-auto flex-1 scrollbar-none">
          {tabs.map((tab) => {
            const hasChanges = tab.content !== tab.originalContent;
            const isActive = tab.path === activeTabPath;

            return (
              <div
                key={tab.path}
                className={cn(
                  "group flex items-center gap-1.5 px-3 h-[35px] border-r text-[13px] cursor-pointer shrink-0 transition-colors",
                  isActive
                    ? "bg-background text-foreground border-b-2 border-b-primary"
                    : "bg-card/30 text-muted-foreground hover:bg-muted/50 border-b-2 border-b-transparent"
                )}
                onClick={() => onSelectTab(tab.path)}
              >
                {/* Modified indicator dot */}
                {hasChanges ? (
                  <span className="w-2 h-2 rounded-full bg-white shrink-0" />
                ) : null}
                <span className="truncate max-w-[140px]">{tab.name}</span>
                {/* Close button */}
                <button
                  className={cn(
                    "ml-1 p-0.5 rounded hover:bg-muted-foreground/20 shrink-0",
                    isActive || hasChanges ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.path);
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Tab Content */}
      {activeTab && (
        <>
          {/* Toolbar */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b bg-card/30 min-h-[36px]">
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground min-w-0">
              <span className="truncate">{activeTab.path}</span>
              <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono shrink-0">
                {activeTab.language}
              </span>
              {activeTab.content !== activeTab.originalContent && (
                <span className="px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 text-[10px] shrink-0">
                  Modified
                </span>
              )}
              {saveStatus[activeTab.path] && (
                <span className={cn(
                  "text-[11px] shrink-0",
                  saveStatus[activeTab.path] === "saved" || saveStatus[activeTab.path] === "copied"
                    ? "text-green-400"
                    : saveStatus[activeTab.path] === "error"
                    ? "text-red-400"
                    : "text-muted-foreground"
                )}>
                  {saveStatus[activeTab.path] === "saving" && "Saving..."}
                  {saveStatus[activeTab.path] === "saved" && "Saved!"}
                  {saveStatus[activeTab.path] === "copied" && "Copied!"}
                  {saveStatus[activeTab.path] === "error" && "Save failed"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => handleCopy(activeTab.path)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                Copy
              </Button>
              <Button
                variant={activeTab.editing ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onUpdateTab(activeTab.path, { editing: !activeTab.editing })}
              >
                {activeTab.editing ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                    Preview
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>
                    Edit
                  </>
                )}
              </Button>
              {activeTab.content !== activeTab.originalContent && (
                <Button
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => handleSave(activeTab.path)}
                  disabled={saveStatus[activeTab.path] === "saving"}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/></svg>
                  Save
                </Button>
              )}
            </div>
          </div>

          {/* Editor/Viewer */}
          <div className="flex-1 overflow-auto">
            {activeTab.loading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Loading...
              </div>
            ) : activeTab.editing ? (
              <textarea
                value={activeTab.content}
                onChange={(e) => onUpdateTab(activeTab.path, { content: e.target.value })}
                className="w-full h-full p-4 font-mono text-[13px] leading-relaxed bg-zinc-950 text-zinc-300 resize-none focus:outline-none"
                spellCheck={false}
              />
            ) : (
              <SyntaxHighlighter
                language={activeTab.language}
                style={oneDark}
                customStyle={{
                  margin: 0,
                  borderRadius: 0,
                  minHeight: "100%",
                  fontSize: "13px",
                  lineHeight: "1.6",
                }}
                showLineNumbers
                lineNumberStyle={{ minWidth: "3em", paddingRight: "1em", color: "#555" }}
              >
                {activeTab.content}
              </SyntaxHighlighter>
            )}
          </div>
        </>
      )}
    </div>
  );
}
