"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { OutputFile } from "@/types/pipeline";

interface OutputBrowserProps {
  selectedPath: string | null;
  openPaths: Set<string>;
  onSelectFile: (path: string) => void;
}

export function OutputBrowser({ selectedPath, openPaths, onSelectFile }: OutputBrowserProps) {
  const [files, setFiles] = useState<OutputFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/files/outputs");
      const data = await res.json();
      setFiles(data.files || []);
      // Auto-expand all directories
      const dirs = (data.files || []).filter((f: OutputFile) => f.isDirectory).map((f: OutputFile) => f.path);
      setExpandedDirs(new Set(dirs));
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchFiles(); }, []);

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const getFileIcon = (name: string) => {
    if (name.endsWith(".py")) return { label: "PY", color: "text-yellow-500" };
    if (name.endsWith(".cpp") || name.endsWith(".h")) return { label: "C+", color: "text-blue-400" };
    if (name.endsWith(".java")) return { label: "JV", color: "text-orange-400" };
    if (name.endsWith(".js")) return { label: "JS", color: "text-yellow-400" };
    if (name.endsWith(".json")) return { label: "{}", color: "text-yellow-300" };
    if (name.endsWith(".md")) return { label: "M", color: "text-blue-300" };
    if (name.endsWith(".lua")) return { label: "LU", color: "text-indigo-400" };
    if (name.endsWith(".txt")) return { label: "T", color: "text-zinc-400" };
    return { label: "F", color: "text-zinc-400" };
  };

  // Build tree structure
  const topLevel: OutputFile[] = [];
  const children: Map<string, OutputFile[]> = new Map();

  for (const file of files) {
    const parts = file.path.split("/");
    if (parts.length === 1) {
      if (!file.isDirectory) topLevel.push(file);
    } else {
      const parentDir = parts.slice(0, -1).join("/");
      if (!children.has(parentDir)) children.set(parentDir, []);
      if (!file.isDirectory) {
        children.get(parentDir)!.push(file);
      }
    }
  }

  const dirs = files.filter((f) => f.isDirectory);

  if (loading) {
    return <div className="p-3 text-xs text-muted-foreground">Loading files...</div>;
  }

  if (files.length === 0) {
    return <div className="p-3 text-xs text-muted-foreground">No output files yet. Run the pipeline first.</div>;
  }

  return (
    <div className="py-1">
      {/* Refresh button */}
      <button
        onClick={fetchFiles}
        className="w-full text-left px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        Refresh files
      </button>

      {/* Top-level files */}
      {topLevel.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          depth={0}
          selected={selectedPath === file.path}
          isOpen={openPaths.has(file.path)}
          icon={getFileIcon(file.name)}
          onClick={() => onSelectFile(file.path)}
        />
      ))}

      {/* Directories */}
      {dirs.map((dir) => (
        <div key={dir.path}>
          <button
            className="flex items-center gap-1 w-full text-left px-3 py-[3px] text-[13px] hover:bg-muted/50 transition-colors"
            onClick={() => toggleDir(dir.path)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={cn(
                "shrink-0 transition-transform text-muted-foreground",
                expandedDirs.has(dir.path) && "rotate-90"
              )}
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
            <span className="font-medium truncate">{dir.name}</span>
          </button>
          {expandedDirs.has(dir.path) && (
            <div>
              {(children.get(dir.path) || []).map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  depth={1}
                  selected={selectedPath === file.path}
                  isOpen={openPaths.has(file.path)}
                  icon={getFileIcon(file.name)}
                  onClick={() => onSelectFile(file.path)}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FileRow({
  file,
  depth,
  selected,
  isOpen,
  icon,
  onClick,
}: {
  file: OutputFile;
  depth: number;
  selected: boolean;
  isOpen: boolean;
  icon: { label: string; color: string };
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-1.5 w-full text-left py-[3px] text-[13px] transition-colors",
        depth === 0 ? "px-3" : "px-3 pl-8",
        selected
          ? "bg-primary/15 text-foreground"
          : isOpen
          ? "bg-muted/30 text-foreground"
          : "text-foreground/80 hover:bg-muted/50"
      )}
      onClick={onClick}
    >
      <span className={cn("text-[10px] font-mono font-bold shrink-0 w-4 text-center", icon.color)}>
        {icon.label}
      </span>
      <span className="truncate">{file.name}</span>
    </button>
  );
}
