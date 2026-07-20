"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { copyToClipboard } from "@/lib/clipboard";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface FileEditorProps {
  filePath: string | null;
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

export function FileEditor({ filePath }: FileEditorProps) {
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const hasChanges = content !== originalContent;
  const ext = filePath?.split(".").pop() || "";
  const language = EXT_TO_LANGUAGE[ext] || "text";

  const fetchContent = useCallback(async () => {
    if (!filePath) return;
    setLoading(true);
    setSaveMessage(null);
    setEditing(false);
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setContent(data.content);
      setOriginalContent(data.content);
    } catch (err) {
      setContent(`Error: ${err instanceof Error ? err.message : "Failed to load"}`);
    } finally {
      setLoading(false);
    }
  }, [filePath]);

  useEffect(() => { fetchContent(); }, [fetchContent]);

  const handleSave = async () => {
    if (!filePath) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/files/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOriginalContent(content);
      setSaveMessage("Saved successfully");
      setEditing(false);
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage(`Error: ${err instanceof Error ? err.message : "Save failed"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    const ok = await copyToClipboard(content);
    setSaveMessage(ok ? "Copied to clipboard" : "Copy failed");
    setTimeout(() => setSaveMessage(null), 2000);
  };

  if (!filePath) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a file to view
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{filePath}</span>
          <Badge variant="outline" className="text-[10px]">
            {language}
          </Badge>
          {hasChanges && (
            <Badge variant="secondary" className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 text-[10px]">
              Unsaved
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saveMessage && (
            <span className={`text-xs ${saveMessage.startsWith("Error") ? "text-red-500" : "text-green-500"}`}>
              {saveMessage}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={handleCopy}>
            Copy
          </Button>
          <Button
            variant={editing ? "outline" : "secondary"}
            size="sm"
            onClick={() => setEditing(!editing)}
          >
            {editing ? "Preview" : "Edit"}
          </Button>
          {hasChanges && (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {editing ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-full min-h-[400px] p-4 font-mono text-sm bg-zinc-950 text-zinc-300 resize-none focus:outline-none"
            spellCheck={false}
          />
        ) : (
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            customStyle={{ margin: 0, borderRadius: 0, minHeight: "400px" }}
            showLineNumbers
          >
            {content}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
