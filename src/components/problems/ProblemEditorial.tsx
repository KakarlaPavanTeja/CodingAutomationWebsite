"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  Copy,
  Download,
  Check,
  Loader2,
  Pencil,
  Eye,
  Save,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Play,
  Square,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePipeline } from "@/lib/pipeline-context";
import { getStepConfig } from "@/lib/pipeline-config";
import {
  formatPipelineCost,
  formatTokenCount,
  type RunUsageSummary,
} from "@/lib/pipeline-usage-match";

interface ProblemEditorialProps {
  problemId: string;
  problemName: string;
  onStatusChange?: () => void;
}

/* ------------------------------------------------------------------ */
/* Block model — the editorial markdown is parsed into ordered blocks. */
/* Serializing the blocks back reproduces the exact custom-tag         */
/* structure (<CodeBlock> / <MultiLanguageCodeBlock>) so downstream    */
/* tags stay intact across edit → save.                               */
/* ------------------------------------------------------------------ */

type ProseBlock = { kind: "prose"; text: string; id: string };
type CodeBlockT = { kind: "codeblock"; language: string; code: string; id: string };
type LangCode = { lang: string; code: string };
type MultiBlock = { kind: "multilang"; langs: LangCode[]; id: string };
type Block = ProseBlock | CodeBlockT | MultiBlock;

const BLOCK_RE =
  /<CodeBlock\b[^>]*>[\s\S]*?<\/CodeBlock>|<MultiLanguageCodeBlock\b[^>]*>[\s\S]*?<\/MultiLanguageCodeBlock>/g;

const FENCE_RE = /```([a-zA-Z0-9+#._-]*)[ \t]*\n([\s\S]*?)```/g;

function parseEditorial(raw: string): Block[] {
  const blocks: Block[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(raw)) !== null) {
    const prose = raw.slice(last, m.index);
    // Stable id from the source offset: unchanged for blocks before the edit
    // point, so React keeps caret/selection/expanded state on the right block
    // even when a structural edit changes the block count (UI-H4/H5).
    if (prose) blocks.push({ kind: "prose", text: prose, id: `prose-${last}` });
    const tag = m[0];
    if (tag.startsWith("<CodeBlock")) {
      const langMatch = tag.match(/language\s*=\s*"([^"]*)"/);
      let language = langMatch ? langMatch[1] : "pseudocode";
      let inner = tag
        .replace(/^<CodeBlock\b[^>]*>/, "")
        .replace(/<\/CodeBlock>\s*$/, "");
      // The downstream platform format wraps the pseudocode in an inner
      // ```pseudocode fence (with a language={customtext} attribute that has no
      // double quotes). Unwrap that fence when present; otherwise fall back to
      // the raw inner content (older editorials).
      FENCE_RE.lastIndex = 0;
      const fenceMatch = FENCE_RE.exec(inner);
      if (fenceMatch) {
        if (fenceMatch[1]) language = fenceMatch[1].toLowerCase();
        inner = fenceMatch[2];
      }
      if (language === "customtext" || language === "text" || language === "") {
        language = "pseudocode";
      }
      blocks.push({
        kind: "codeblock",
        language,
        code: inner.replace(/^\n/, "").replace(/\n\s*$/, ""),
        id: `code-${m.index}`,
      });
    } else {
      const inner = tag
        .replace(/^<MultiLanguageCodeBlock\b[^>]*>/, "")
        .replace(/<\/MultiLanguageCodeBlock>\s*$/, "");
      const langs: LangCode[] = [];
      let fm: RegExpExecArray | null;
      FENCE_RE.lastIndex = 0;
      while ((fm = FENCE_RE.exec(inner)) !== null) {
        langs.push({ lang: (fm[1] || "text").toLowerCase(), code: fm[2].replace(/\n\s*$/, "") });
      }
      blocks.push({ kind: "multilang", langs, id: `multi-${m.index}` });
    }
    last = m.index + tag.length;
  }
  const tail = raw.slice(last);
  if (tail) blocks.push({ kind: "prose", text: tail, id: `prose-${last}` });
  return blocks;
}

function serializeBlocks(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if (b.kind === "prose") return b.text;
      if (b.kind === "codeblock") {
        const lang = b.language || "pseudocode";
        return `<CodeBlock language={customtext} showNumberOfLines={15} fontStyle={Normal Code}>\n\n\`\`\`${lang}\n${b.code}\n\`\`\`\n\n</CodeBlock>`;
      }
      const fences = b.langs
        .map((l) => `\`\`\`${l.lang}\n${l.code}\n\`\`\``)
        .join("\n");
      return `<MultiLanguageCodeBlock>\n${fences}\n</MultiLanguageCodeBlock>`;
    })
    .join("");
}

/* ----------------------------- Markdown prose ---------------------------- */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  // Order matters: code first (so ** inside code is literal), then bold, italic.
  const nodes: React.ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (tok.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("**")) {
      nodes.push(<strong key={key} className="font-semibold">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
    } else {
      const lm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (lm) {
        nodes.push(
          <a key={key} href={lm[2]} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            {lm[1]}
          </a>
        );
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function MarkdownProse({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const content = renderInline(h[2], `h-${key}`);
      const sizes = ["text-2xl", "text-xl", "text-lg", "text-base", "text-sm", "text-sm"];
      out.push(
        <div
          key={`h-${key++}`}
          className={cn(
            "font-semibold tracking-tight text-foreground",
            sizes[level - 1],
            level <= 2 ? "mt-6 mb-3 border-b pb-2" : "mt-5 mb-2"
          )}
        >
          {content}
        </div>
      );
      i++;
      continue;
    }

    // Blockquote (used for the "sub-optimal" note)
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(
        <blockquote
          key={`q-${key++}`}
          className="my-3 rounded-r-md border-l-4 border-amber-500/70 bg-amber-500/10 px-4 py-2 text-sm text-foreground"
        >
          {renderInline(quote.join(" "), `q-${key}`)}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      out.push(
        <ul key={`ul-${key++}`} className="my-3 ml-5 list-disc space-y-1.5 text-sm text-muted-foreground">
          {items.map((it, idx) => (
            <li key={idx} className="leading-relaxed">{renderInline(it, `ul-${key}-${idx}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      out.push(
        <ol key={`ol-${key++}`} className="my-3 ml-5 list-decimal space-y-1.5 text-sm text-muted-foreground">
          {items.map((it, idx) => (
            <li key={idx} className="leading-relaxed">{renderInline(it, `ol-${key}-${idx}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph (gather consecutive non-blank, non-structural lines)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(
      <p key={`p-${key++}`} className="my-3 text-sm leading-relaxed text-muted-foreground">
        {renderInline(para.join(" "), `p-${key}`)}
      </p>
    );
  }

  return <div>{out}</div>;
}

/* ----------------------------- Code blocks ------------------------------ */

const SYNTAX_LANG: Record<string, string> = {
  cpp: "cpp",
  "c++": "cpp",
  python: "python",
  py: "python",
  java: "java",
  javascript: "javascript",
  js: "javascript",
  nodejs: "javascript",
};

const LANG_LABEL: Record<string, string> = {
  cpp: "C++",
  python: "Python",
  java: "Java",
  javascript: "JavaScript",
  js: "JavaScript",
  nodejs: "JavaScript",
};

const COLLAPSED_HEIGHT = 360;

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-md bg-white/10 p-1.5 text-zinc-300 transition-colors hover:bg-white/20 hover:text-white"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/** Pseudocode renderer: line numbers + `/* *​/` and HTML-style `<tag>` styled as comments. */
function PseudocodeView({ code }: { code: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = code.split("\n");
  const overflowing = lines.length > 18;

  const renderLine = (line: string, idx: number) => {
    // Split into segments: /* comment */ and <html-style tag>, both styled as comments.
    const parts: React.ReactNode[] = [];
    const re = /(\/\*[\s\S]*?\*\/)|(<[^<>]+>)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) parts.push(<span key={`t${k++}`}>{line.slice(last, m.index)}</span>);
      parts.push(
        <span key={`c${k++}`} className="text-zinc-500 italic">
          {m[0]}
        </span>
      );
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(<span key={`t${k++}`}>{line.slice(last)}</span>);
    return (
      <div key={idx} className="flex">
        <span className="mr-4 inline-block w-8 shrink-0 select-none text-right text-zinc-600">{idx + 1}</span>
        <span className="whitespace-pre text-zinc-200">{parts.length ? parts : "\u00A0"}</span>
      </div>
    );
  };

  return (
    <div className="relative my-3 overflow-hidden rounded-lg border border-zinc-800 bg-[#282c34]">
      <div className="absolute right-2 top-2 z-10">
        <CopyButton value={code} />
      </div>
      <div
        className="overflow-auto p-4 font-mono text-[13px] leading-6"
        style={{ maxHeight: expanded ? "none" : COLLAPSED_HEIGHT }}
      >
        {lines.map(renderLine)}
      </div>
      {overflowing && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="absolute bottom-2 right-2 z-10 flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/20 hover:text-white"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Collapse" : "Expand"}
        </button>
      )}
    </div>
  );
}

function HighlightedCode({ code, language }: { code: string; language: string }) {
  const [expanded, setExpanded] = useState(false);
  const overflowing = code.split("\n").length > 18;
  const syntax = SYNTAX_LANG[language] || "text";
  return (
    <div className="relative overflow-hidden rounded-lg border border-zinc-800 bg-[#282c34]">
      <div className="absolute right-2 top-2 z-10">
        <CopyButton value={code} />
      </div>
      <div className="overflow-auto" style={{ maxHeight: expanded ? "none" : COLLAPSED_HEIGHT }}>
        <SyntaxHighlighter
          language={syntax}
          style={oneDark}
          showLineNumbers
          customStyle={{ margin: 0, background: "transparent", fontSize: "13px", lineHeight: "1.6" }}
          lineNumberStyle={{ minWidth: "2.5em", paddingRight: "1em", color: "#5c6370" }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
      {overflowing && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="absolute bottom-2 right-2 z-10 flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/20 hover:text-white"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Collapse" : "Expand"}
        </button>
      )}
    </div>
  );
}

function CodeBlockView({ block }: { block: CodeBlockT }) {
  if (block.language === "pseudocode") {
    return <PseudocodeView code={block.code} />;
  }
  return (
    <div className="my-3">
      <HighlightedCode code={block.code} language={block.language} />
    </div>
  );
}

function MultiLangView({ block }: { block: MultiBlock }) {
  const [sel, setSel] = useState(0);
  if (block.langs.length === 0) return null;
  const safeSel = Math.min(sel, block.langs.length - 1);
  const active = block.langs[safeSel];
  return (
    <div className="my-3">
      <div className="mb-2 flex justify-end">
        <select
          value={safeSel}
          onChange={(e) => setSel(Number(e.target.value))}
          className="w-44 rounded-lg border border-input bg-background px-3 py-1.5 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {block.langs.map((l, idx) => (
            <option key={idx} value={idx}>
              {LANG_LABEL[l.lang] || l.lang.toUpperCase()}
            </option>
          ))}
        </select>
      </div>
      <HighlightedCode code={active.code} language={active.lang} />
    </div>
  );
}

/* ------------------------------ Editor view ------------------------------ */

function BlockEditor({
  blocks,
  onChange,
}: {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
}) {
  const update = (idx: number, next: Block) => {
    const copy = blocks.slice();
    copy[idx] = next;
    onChange(copy);
  };

  return (
    <div className="space-y-3">
      {blocks.map((b, idx) => {
        if (b.kind === "prose") {
          return (
            <textarea
              key={b.id}
              value={b.text}
              onChange={(e) => update(idx, { kind: "prose", text: e.target.value, id: b.id })}
              spellCheck={false}
              rows={Math.min(20, Math.max(3, b.text.split("\n").length))}
              className="w-full resize-y rounded-md border bg-background p-3 font-mono text-[13px] leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          );
        }
        if (b.kind === "codeblock") {
          return (
            <div key={b.id} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
              <div className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">
                CodeBlock · {b.language}
              </div>
              <textarea
                value={b.code}
                onChange={(e) => update(idx, { ...b, code: e.target.value })}
                spellCheck={false}
                rows={Math.min(30, Math.max(4, b.code.split("\n").length))}
                className="w-full resize-y rounded bg-zinc-950 p-3 font-mono text-[13px] leading-relaxed text-zinc-200 focus:outline-none"
              />
            </div>
          );
        }
        return (
          <div key={b.id} className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2 space-y-2">
            <div className="px-1 text-[11px] font-medium uppercase tracking-wider text-blue-600 dark:text-blue-400">
              MultiLanguageCodeBlock
            </div>
            {b.langs.map((l, li) => (
              <div key={li}>
                <div className="mb-1 px-1 text-[11px] text-muted-foreground">{LANG_LABEL[l.lang] || l.lang}</div>
                <textarea
                  value={l.code}
                  onChange={(e) => {
                    const langs = b.langs.slice();
                    langs[li] = { ...l, code: e.target.value };
                    update(idx, { ...b, langs });
                  }}
                  spellCheck={false}
                  rows={Math.min(30, Math.max(4, l.code.split("\n").length))}
                  className="w-full resize-y rounded bg-zinc-950 p-3 font-mono text-[13px] leading-relaxed text-zinc-200 focus:outline-none"
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------ Main component ---------------------------- */

export function ProblemEditorial({ problemId, problemName, onStatusChange }: ProblemEditorialProps) {
  const {
    stepStates,
    globalLanguages,
    isAnyRunning,
    stateLoading,
    loadProblemState,
    runStep,
    stopStep,
  } = usePipeline();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [editing, setEditing] = useState(false);
  const [editMode, setEditMode] = useState<"blocks" | "raw">("blocks");
  const [editBlocks, setEditBlocks] = useState<Block[]>([]);
  const [rawText, setRawText] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [copied, setCopied] = useState(false);
  // LLM usage for the editorial: `latest` = the most recent Generate Editorial
  // run, `total` = every editorial generation summed (so a re-run shows both
  // this run's cost and the running total).
  const [editorialUsage, setEditorialUsage] = useState<{
    latest: RunUsageSummary | null;
    total: RunUsageSummary | null;
  }>({ latest: null, total: null });

  const generateState = stepStates.get("generate_editorial");
  const executeState = stepStates.get("execute_editorial");
  const packageState = stepStates.get("package_platform");
  const genRunning = generateState?.status === "running";
  const execRunning = executeState?.status === "running";

  useEffect(() => {
    loadProblemState(problemId);
  }, [problemId, loadProblemState]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    fetch(`/api/files/read?path=${encodeURIComponent("editorial.md")}&problemId=${encodeURIComponent(problemId)}`)
      .then(async (r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || "Failed to load editorial");
        }
        return r.json();
      })
      .then((data) => {
        if (data) {
          setContent(data.content);
          setOriginal(data.content);
          setEditing(false);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [problemId]);

  useEffect(() => {
    load();
  }, [load]);

  const prevGenStatus = useRef(generateState?.status);
  useEffect(() => {
    const status = generateState?.status;
    if (prevGenStatus.current === "running" && status === "completed") {
      load();
      onStatusChange?.();
    }
    prevGenStatus.current = status;
  }, [generateState?.status, load, onStatusChange]);

  const prevExecStatus = useRef(executeState?.status);
  useEffect(() => {
    const status = executeState?.status;
    if (prevExecStatus.current === "running" && status !== "running") {
      onStatusChange?.();
    }
    prevExecStatus.current = status;
  }, [executeState?.status, onStatusChange]);

  const fetchUsage = useCallback(() => {
    fetch(`/api/pipeline/usage?problemId=${encodeURIComponent(problemId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setEditorialUsage({
          latest: data.usage?.generate_editorial ?? null,
          total: data.totals?.generate_editorial ?? null,
        });
      })
      .catch(() => {});
  }, [problemId]);

  // Load usage on mount / problem change, refresh when a generation finishes,
  // and poll while one is running so the cost ticks in live.
  useEffect(() => {
    fetchUsage();
  }, [fetchUsage, generateState?.status]);

  useEffect(() => {
    if (!genRunning) return;
    const t = setInterval(fetchUsage, 5000);
    return () => clearInterval(t);
  }, [genRunning, fetchUsage]);

  const blocks = useMemo(() => parseEditorial(content), [content]);

  // While editing, the pending content is derived from the active editor's own
  // local state (NOT re-parsed from `content` on every keystroke), so what the
  // user types is preserved verbatim and only serialized once — on save.
  const pendingContent = editing
    ? editMode === "raw"
      ? rawText
      : serializeBlocks(editBlocks)
    : content;
  const dirty = pendingContent !== original;

  const enterEdit = () => {
    setEditBlocks(parseEditorial(content));
    setRawText(content);
    setEditing(true);
  };

  const exitEdit = () => {
    setContent(pendingContent);
    setEditing(false);
  };

  const switchEditMode = (next: "blocks" | "raw") => {
    if (next === editMode) return;
    if (next === "raw") {
      setRawText(serializeBlocks(editBlocks));
    } else {
      setEditBlocks(parseEditorial(rawText));
    }
    setEditMode(next);
  };

  const handleSave = async () => {
    const out = pendingContent;
    setSaveState("saving");
    try {
      const res = await fetch(
        `/api/files/save?problemId=${encodeURIComponent(problemId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "editorial.md", content: out }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Save failed");
      }
      setContent(out);
      setOriginal(out);
      setSaveState("saved");
      setEditing(false);
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 2500);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(pendingContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownload = () => {
    const blob = new Blob([pendingContent], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (problemName || "editorial").replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60);
    a.href = url;
    a.download = `${safeName || "editorial"}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const packageComplete = packageState?.status === "completed";
  const editorialComplete = generateState?.status === "completed";
  const canGenerate =
    packageComplete && !genRunning && !execRunning && generateState?.status !== "running";
  const canExecute =
    editorialComplete &&
    !notFound &&
    !genRunning &&
    !execRunning &&
    executeState?.status !== "running";

  const handleGenerateEditorial = () => {
    const state = generateState ?? {
      id: "generate_editorial" as const,
      status: "pending" as const,
      logs: [],
      exitCode: null,
      startTime: null,
      endTime: null,
      enabledSubSteps: getStepConfig("generate_editorial").subSteps
        .filter((s) => s.defaultEnabled)
        .map((s) => s.id),
      enabledLanguages: [],
      testcaseCount: 0,
    };
    runStep(state);
    onStatusChange?.();
  };

  const handleExecuteSolutions = () => {
    const state = executeState;
    if (!state) return;
    runStep({ ...state, enabledLanguages: globalLanguages });
    onStatusChange?.();
  };

  const handleStopGenerate = () => stopStep("generate_editorial");
  const handleStopExecute = () => stopStep("execute_editorial");

  const pipelineBusy = stateLoading || isAnyRunning;

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border bg-card py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={load}>
          Retry
        </Button>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <BookOpen className="h-4 w-4 text-primary" />
            Editorial
          </h2>
          <div className="flex items-center gap-1.5">
            {genRunning ? (
              <Button size="sm" variant="destructive" className="h-8" onClick={handleStopGenerate}>
                <Square className="mr-1.5 h-3.5 w-3.5 fill-current" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-8"
                disabled={!canGenerate || pipelineBusy}
                onClick={handleGenerateEditorial}
              >
                {pipelineBusy && !genRunning ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                )}
                Generate Editorial
              </Button>
            )}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-10 text-center">
          <BookOpen className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <h3 className="mt-3 text-sm font-semibold">No editorial yet</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {packageComplete
              ? "Click Generate Editorial to produce a complete multi-solution editorial."
              : "Complete Package for Platform in the Pipeline tab first, then generate the editorial here."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BookOpen className="h-4 w-4 text-primary" />
          Editorial
          {saveState === "saved" && <span className="text-xs font-normal text-green-500">Saved!</span>}
          {saveState === "error" && <span className="text-xs font-normal text-red-500">Save failed</span>}
        </h2>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8" onClick={handleCopy}>
            {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            Copy
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={handleDownload}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download
          </Button>
          <Button
            variant={editing ? "secondary" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => (editing ? exitEdit() : enterEdit())}
          >
            {editing ? <Eye className="mr-1.5 h-3.5 w-3.5" /> : <Pencil className="mr-1.5 h-3.5 w-3.5" />}
            {editing ? "Preview" : "Edit"}
          </Button>
          {dirty && (
            <Button size="sm" className="h-8" onClick={handleSave} disabled={saveState === "saving"}>
              {saveState === "saving" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" />
              )}
              Save
            </Button>
          )}
          {genRunning ? (
            <Button size="sm" variant="destructive" className="h-8" onClick={handleStopGenerate}>
              <Square className="mr-1.5 h-3.5 w-3.5 fill-current" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={!canGenerate || pipelineBusy}
              onClick={handleGenerateEditorial}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Generate Editorial
            </Button>
          )}
          {execRunning ? (
            <Button size="sm" variant="destructive" className="h-8" onClick={handleStopExecute}>
              <Square className="mr-1.5 h-3.5 w-3.5 fill-current" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-8"
              disabled={!canExecute || pipelineBusy}
              onClick={handleExecuteSolutions}
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              Execute Solutions
            </Button>
          )}
        </div>
      </div>

      {/* LLM usage: model, tokens, this-run cost, and running total across re-runs */}
      {(() => {
        const latest = editorialUsage.latest;
        const total = editorialUsage.total;
        if (!latest && !total) return null;
        const models = (latest?.models?.length ? latest.models : total?.models) ?? [];
        const latestTokens = latest ? latest.promptTokens + latest.completionTokens : 0;
        const runCount = total?.callCount ?? latest?.callCount ?? 0;
        // Only surface a separate "total" once there's been more than one run
        // (or the totals genuinely differ from this run's numbers).
        const showTotal =
          !!total && (runCount > (latest?.callCount ?? 0) || total.costUsd !== (latest?.costUsd ?? 0));
        return (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            {models.length > 0 && (
              <span>
                Model:{" "}
                <span className="font-medium text-foreground">{models.join(", ")}</span>
              </span>
            )}
            {latest && (
              <span>
                Tokens:{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatTokenCount(latestTokens)}
                </span>{" "}
                ({formatTokenCount(latest.promptTokens)} in ·{" "}
                {formatTokenCount(latest.completionTokens)} out)
              </span>
            )}
            {latest && (
              <span>
                This run:{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatPipelineCost(latest.costUsd)}
                </span>
              </span>
            )}
            {showTotal && total && (
              <span>
                Total{runCount > 1 ? ` (${runCount} runs)` : ""}:{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatPipelineCost(total.costUsd)}
                </span>
              </span>
            )}
          </div>
        );
      })()}

      {/* Body */}
      <div className="rounded-lg border bg-card p-5 sm:p-6">
        {editing ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Editing
              </span>
              <div className="inline-flex overflow-hidden rounded-md border">
                <button
                  type="button"
                  onClick={() => switchEditMode("blocks")}
                  className={cn(
                    "px-3 py-1 text-xs font-medium transition-colors",
                    editMode === "blocks"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted"
                  )}
                >
                  Blocks
                </button>
                <button
                  type="button"
                  onClick={() => switchEditMode("raw")}
                  className={cn(
                    "px-3 py-1 text-xs font-medium transition-colors",
                    editMode === "raw"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted"
                  )}
                >
                  Raw markdown
                </button>
              </div>
              <span className="text-xs text-muted-foreground">
                {editMode === "raw"
                  ? "Edit the full editorial source — replace anything, then Save."
                  : "Edit each section in place."}
              </span>
            </div>
            {editMode === "raw" ? (
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                spellCheck={false}
                className="min-h-[60vh] w-full resize-y rounded-md border bg-background p-3 font-mono text-[13px] leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <BlockEditor blocks={editBlocks} onChange={setEditBlocks} />
            )}
          </div>
        ) : (
          <div className="max-w-none">
            {blocks.map((b) => {
              if (b.kind === "prose") return <MarkdownProse key={b.id} text={b.text} />;
              if (b.kind === "codeblock") return <CodeBlockView key={b.id} block={b} />;
              return <MultiLangView key={b.id} block={b} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
