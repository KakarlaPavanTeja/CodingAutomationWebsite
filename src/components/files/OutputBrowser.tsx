"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { OutputFile } from "@/types/pipeline";

interface OutputBrowserProps {
  selectedPath: string | null;
  openPaths: Set<string>;
  onSelectFile: (path: string) => void;
  problemId?: string | null;
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
  children: TreeNode[];
}

function buildTree(files: OutputFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  // First pass: create all directory nodes
  for (const file of files) {
    if (file.isDirectory) {
      const node: TreeNode = {
        name: file.name,
        path: file.path,
        isDirectory: true,
        size: 0,
        modifiedAt: "",
        children: [],
      };
      dirMap.set(file.path, node);
    }
  }

  // Second pass: assign directories to parents
  for (const [dirPath, node] of dirMap) {
    const parts = dirPath.split("/");
    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = dirMap.get(parentPath);
      if (parent) {
        parent.children.push(node);
      } else {
        root.push(node);
      }
    }
  }

  // Third pass: assign files to their parent directories
  for (const file of files) {
    if (file.isDirectory) continue;

    const parts = file.path.split("/");
    const fileNode: TreeNode = {
      name: file.name,
      path: file.path,
      isDirectory: false,
      size: file.size,
      modifiedAt: file.modifiedAt,
      children: [],
    };

    if (parts.length === 1) {
      root.push(fileNode);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = dirMap.get(parentPath);
      if (parent) {
        parent.children.push(fileNode);
      } else {
        root.push(fileNode);
      }
    }
  }

  // Sort: directories first, then files, alphabetical
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children.length > 0) sortNodes(node.children);
    }
  };
  sortNodes(root);

  return root;
}

function getFileIcon(name: string) {
  if (name.endsWith(".py")) return { label: "PY", color: "text-yellow-500" };
  if (name.endsWith(".cpp") || name.endsWith(".h")) return { label: "C+", color: "text-blue-400" };
  if (name.endsWith(".java")) return { label: "JV", color: "text-orange-400" };
  if (name.endsWith(".js")) return { label: "JS", color: "text-yellow-400" };
  if (name.endsWith(".json")) return { label: "{}", color: "text-yellow-300" };
  if (name.endsWith(".md")) return { label: "M", color: "text-blue-300" };
  if (name.endsWith(".lua")) return { label: "LU", color: "text-indigo-400" };
  if (name.endsWith(".txt")) return { label: "T", color: "text-zinc-400" };
  return { label: "F", color: "text-zinc-400" };
}

export function OutputBrowser({ selectedPath, openPaths, onSelectFile, problemId }: OutputBrowserProps) {
  const [files, setFiles] = useState<OutputFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const url = problemId
        ? `/api/files/outputs?problemId=${encodeURIComponent(problemId)}`
        : "/api/files/outputs";
      const res = await fetch(url);
      const data = await res.json();
      setFiles(data.files || []);
      const dirs = (data.files || []).filter((f: OutputFile) => f.isDirectory).map((f: OutputFile) => f.path);
      setExpandedDirs(new Set(dirs));
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [problemId]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const tree = useMemo(() => buildTree(files), [files]);

  const allDirPaths = useMemo(
    () => files.filter((f) => f.isDirectory).map((f) => f.path),
    [files]
  );
  const allExpanded = allDirPaths.length > 0 && allDirPaths.every((p) => expandedDirs.has(p));

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    setExpandedDirs(allExpanded ? new Set() : new Set(allDirPaths));
  };

  if (loading) {
    return <div className="p-3 text-xs text-muted-foreground">Loading files...</div>;
  }

  if (files.length === 0) {
    return <div className="p-3 text-xs text-muted-foreground">No output files yet. Run the pipeline first.</div>;
  }

  return (
    <div className="py-1">
      <div className="flex items-center justify-between px-3 py-1">
        <button
          onClick={fetchFiles}
          className="text-left text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Refresh files
        </button>
        {allDirPaths.length > 0 && (
          <button
            onClick={toggleAll}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        )}
      </div>

      {tree.map((node) => (
        <TreeNodeRow
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          openPaths={openPaths}
          expandedDirs={expandedDirs}
          onToggleDir={toggleDir}
          onSelectFile={onSelectFile}
          problemId={problemId}
        />
      ))}
    </div>
  );
}

function TreeNodeRow({
  node,
  depth,
  selectedPath,
  openPaths,
  expandedDirs,
  onToggleDir,
  onSelectFile,
  problemId,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  openPaths: Set<string>;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  problemId?: string | null;
}) {
  const paddingLeft = 12 + depth * 16;

  if (node.isDirectory) {
    const isExpanded = expandedDirs.has(node.path);
    return (
      <>
        <button
          className="flex items-center gap-1 w-full text-left py-[3px] text-[13px] hover:bg-muted/50 transition-colors"
          style={{ paddingLeft }}
          onClick={() => onToggleDir(node.path)}
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
              isExpanded && "rotate-90"
            )}
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
          <span className="font-medium truncate">{node.name}</span>
          <span className="ml-auto text-[10px] text-muted-foreground pr-2">
            {node.children.filter((c) => !c.isDirectory).length}
          </span>
        </button>
        {isExpanded &&
          node.children.map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              openPaths={openPaths}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              onSelectFile={onSelectFile}
              problemId={problemId}
            />
          ))}
      </>
    );
  }

  const icon = getFileIcon(node.name);
  const selected = selectedPath === node.path;
  const isOpen = openPaths.has(node.path);
  const downloadUrl = problemId
    ? `/api/files/download?problemId=${encodeURIComponent(problemId)}&path=${encodeURIComponent(node.path)}`
    : null;

  return (
    <div
      className={cn(
        "group flex items-center w-full text-[13px] transition-colors",
        selected
          ? "bg-primary/15 text-foreground"
          : isOpen
            ? "bg-muted/30 text-foreground"
            : "text-foreground/80 hover:bg-muted/50"
      )}
    >
      <button
        className="flex items-center gap-1.5 flex-1 min-w-0 text-left py-[3px]"
        style={{ paddingLeft: paddingLeft + 14 }}
        onClick={() => onSelectFile(node.path)}
      >
        <span className={cn("text-[10px] font-mono font-bold shrink-0 w-4 text-center", icon.color)}>
          {icon.label}
        </span>
        <span className="truncate">{node.name}</span>
      </button>
      {downloadUrl && (
        <a
          href={downloadUrl}
          download
          title={`Download ${node.name}`}
          aria-label={`Download ${node.name}`}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 p-1 mr-1.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-foreground hover:bg-muted transition-all"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
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
      )}
    </div>
  );
}
