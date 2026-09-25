"use client";

/**
 * Revision Notes on the Editorial tab: generate the sticky-notes data from the
 * editorial (`generate_revision_notes` step), view the rendered pages (1:
 * approaches, 2: cheat corner) in a zoom/rotate viewer, download them, or edit
 * the fields and re-render without another LLM call.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  ImageIcon,
  Loader2,
  Pencil,
  Play,
  RotateCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  Square,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { StepLogPane } from "@/components/pipeline/StepLogPane";
import { usePipeline } from "@/lib/pipeline-context";
import { getStepConfig } from "@/lib/pipeline-config";
import { formatPipelineCost, type RunUsageSummary } from "@/lib/pipeline-usage-match";
import {
  pageTitle,
  parseRevisionNotes,
  REVISION_NOTES_FILE,
  revisionPages,
  type DryRun,
  type RevisionApproach,
  type RevisionAudit,
  type RevisionNotes,
} from "@/lib/revision-notes/types";
import { cn } from "@/lib/utils";

const STEP_ID = "generate_revision_notes" as const;
const VERIFY_STEP_ID = "verify_revision_notes" as const;

function pendingState(id: typeof STEP_ID | typeof VERIFY_STEP_ID) {
  return {
    id,
    status: "pending" as const,
    logs: [],
    exitCode: null,
    startTime: null,
    endTime: null,
    enabledSubSteps: getStepConfig(id).subSteps.map((s) => s.id),
    enabledLanguages: [],
    testcaseCount: 0,
  };
}

interface PageImage {
  label: string;
  src: string;
  downloadUrl: string;
}

/** Trigger one file download per page (browsers allow a short burst). */
function downloadAll(pages: PageImage[]) {
  pages.forEach((p, i) => {
    setTimeout(() => {
      const a = document.createElement("a");
      a.href = p.downloadUrl;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, i * 400);
  });
}

interface RevisionNotesPanelProps {
  problemId: string;
  /** False while the editorial itself is being generated. */
  editorialReady: boolean;
  onStatusChange?: () => void;
}

export function RevisionNotesPanel({ problemId, editorialReady, onStatusChange }: RevisionNotesPanelProps) {
  const { stepStates, stateLoading, runStep, stopStep } = usePipeline();
  const state = stepStates.get(STEP_ID);
  const verifyState = stepStates.get(VERIFY_STEP_ID);
  const editorialState = stepStates.get("generate_editorial");
  const generating = state?.status === "running" || state?.status === "stopping";
  const verifying = verifyState?.status === "running" || verifyState?.status === "stopping";
  const running = generating || verifying;

  const [notes, setNotes] = useState<RevisionNotes | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped whenever the stored notes change, so the <img>s refetch the PNGs.
  const [version, setVersion] = useState(() => Date.now());
  /** Index of the page open in the viewer, or null when closed. */
  const [viewerPage, setViewerPage] = useState<number | null>(null);
  const [draft, setDraft] = useState<RevisionNotes | null>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineNote, setRefineNote] = useState("");
  const [usage, setUsage] = useState<RunUsageSummary | null>(null);

  // The log pane is closed per run: remembering WHICH run was closed (by its
  // start time) re-opens it automatically when the next run starts.
  const [logsClosedFor, setLogsClosedFor] = useState<number | null | undefined>(undefined);
  const [logsExpanded, setLogsExpanded] = useState(true);

  // Reloads keep showing the current notes until the new ones arrive, so there
  // is no spinner state to set up front — only the async callbacks set state.
  const load = useCallback(() => {
    fetch(`/api/files/read?path=${encodeURIComponent(REVISION_NOTES_FILE)}&problemId=${encodeURIComponent(problemId)}`)
      .then(async (r) => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to load revision notes");
        return r.json();
      })
      .then((data) => {
        setLoadError(null);
        if (!data) {
          setNotes(null);
          return;
        }
        const parsed = parseRevisionNotes(JSON.parse(data.content));
        if (!parsed.ok) throw new Error(`Invalid ${REVISION_NOTES_FILE}: ${parsed.errors.join("; ")}`);
        setNotes(parsed.notes);
        setVersion(Date.now());
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load revision notes"))
      .finally(() => setLoading(false));
  }, [problemId]);

  useEffect(() => {
    load();
  }, [load]);

  const fetchUsage = useCallback(() => {
    fetch(`/api/pipeline/usage?problemId=${encodeURIComponent(problemId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUsage(data?.usage?.[STEP_ID] ?? null))
      .catch(() => {});
  }, [problemId]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage, state?.status]);

  // Reload once a generate or verify run finishes (both rewrite the notes).
  const prevStatus = useRef(state?.status);
  const prevVerify = useRef(verifyState?.status);
  useEffect(() => {
    const finished = (prev: string | undefined, now: string | undefined) => prev === "running" && now === "completed";
    if (finished(prevStatus.current, state?.status) || finished(prevVerify.current, verifyState?.status)) {
      load();
      onStatusChange?.();
    }
    prevStatus.current = state?.status;
    prevVerify.current = verifyState?.status;
  }, [state?.status, verifyState?.status, load, onStatusChange]);

  const handleGenerate = (note?: string) => {
    runStep(state ?? pendingState(STEP_ID), note);
    onStatusChange?.();
  };

  const handleVerify = () => {
    runStep(verifyState ?? pendingState(VERIFY_STEP_ID));
    onStatusChange?.();
  };

  const canGenerate = editorialReady && !running && !stateLoading;
  const base = `/api/problems/${encodeURIComponent(problemId)}/revision-notes/image`;
  const pages: PageImage[] = notes
    ? revisionPages(notes).map((page, i) => ({
        label: `${i + 1} · ${pageTitle(page, notes)}`,
        src: `${base}?page=${i + 1}&v=${version}`,
        downloadUrl: `${base}?page=${i + 1}&download=1&v=${version}`,
      }))
    : [];

  // The editorial was regenerated after these notes were made.
  const stale =
    !!notes &&
    state?.status === "completed" &&
    editorialState?.status === "completed" &&
    (editorialState.endTime ?? 0) > (state.endTime ?? 0);

  // One log pane, for whichever of generate / verify ran last.
  const logState =
    verifyState && (verifyState.startTime ?? 0) > (state?.startTime ?? 0) ? verifyState : state;
  const logLabel = logState?.id === VERIFY_STEP_ID ? "Verify Revision Notes" : "Generate Revision Notes";
  const showLogs =
    !!logState &&
    logsClosedFor !== logState.startTime &&
    ["running", "stopping", "failed", "stopped"].includes(logState.status);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ImageIcon className="h-4 w-4 text-primary" />
          Revision Notes
          {usage && (
            <span className="text-[11px] font-normal text-muted-foreground">
              · last run {formatPipelineCost(usage.costUsd)}
            </span>
          )}
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {notes && !draft && (
            <>
              <Button variant="outline" size="sm" className="h-8" onClick={() => setViewerPage(0)}>
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                View
              </Button>
              <Button variant="outline" size="sm" className="h-8" onClick={() => downloadAll(pages)}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                {pages.length > 1 ? `Download (${pages.length})` : "Download"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={running}
                onClick={() => setDraft(structuredClone(notes))}
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Edit
              </Button>
            </>
          )}
          {running ? (
            <Button
              size="sm"
              variant="destructive"
              className="h-8"
              onClick={() => stopStep(generating ? STEP_ID : VERIFY_STEP_ID)}
            >
              <Square className="mr-1.5 h-3.5 w-3.5 fill-current" />
              Stop
            </Button>
          ) : (
            !draft && (
              <>
                {notes && (
                  <Button
                    variant={refineOpen ? "secondary" : "outline"}
                    size="sm"
                    className="h-8"
                    disabled={!canGenerate}
                    onClick={() => setRefineOpen((v) => !v)}
                  >
                    <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                    Refine
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={notes ? "outline" : "default"}
                  className="h-8"
                  disabled={!canGenerate}
                  title={editorialReady ? undefined : "Wait for the editorial to finish generating"}
                  onClick={() => handleGenerate()}
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  {notes ? "Regenerate" : "Generate Revision Notes"}
                </Button>
              </>
            )
          )}
        </div>
      </div>

      {refineOpen && !running && !draft && (
        <div className="space-y-1.5 border-b bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">
            Tell the LLM what to change, then regenerate. Manual edits to the current notes will be replaced.
          </p>
          <textarea
            value={refineNote}
            onChange={(e) => setRefineNote(e.target.value)}
            rows={2}
            maxLength={4000}
            placeholder="e.g. Add a Better note for the hash map approach; add an edge case for negative numbers"
            className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-xs leading-snug focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!canGenerate || !refineNote.trim()}
              onClick={() => {
                handleGenerate(refineNote.trim());
                setRefineOpen(false);
              }}
            >
              <Play className="mr-1.5 h-3 w-3" />
              Regenerate with changes
            </Button>
          </div>
        </div>
      )}

      {showLogs && logState && (
        <div className={cn("border-b", logsExpanded && "flex h-64 flex-col")}>
          <StepLogPane
            label={logLabel}
            status={logState.status}
            problemId={problemId}
            logStepId={logState.id}
            activeRunId={logState.activeRunId}
            liveLogs={logState.logs}
            isExpanded={logsExpanded}
            onToggleExpand={() => setLogsExpanded((v) => !v)}
            onClose={() => setLogsClosedFor(logState.startTime)}
          />
        </div>
      )}

      <div className="p-4">
        {stale && !draft && (
          <p className="mb-3 flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            The editorial was regenerated after these notes were made. Regenerate to bring them in line.
          </p>
        )}
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : draft ? (
          <RevisionNotesEditor
            problemId={problemId}
            draft={draft}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSaved={() => {
              setDraft(null);
              load();
            }}
          />
        ) : notes ? (
          <div className="space-y-3">
          <SafetyCheck audit={notes.audit} verifying={verifying} canVerify={!running && !stateLoading} onVerify={handleVerify} />
          <div className={cn("grid gap-3", pages.length > 1 && "sm:grid-cols-2")}>
            {pages.map((p, i) => (
              <button
                key={p.src}
                type="button"
                onClick={() => setViewerPage(i)}
                className="group flex flex-col overflow-hidden rounded-md border bg-[#f6f3ec] text-left"
                title={`Open page ${p.label}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- dynamic, auth-gated PNG */}
                <img
                  src={p.src}
                  alt={`Revision notes page ${p.label}: ${notes.title}`}
                  className="mx-auto max-h-72 w-auto object-contain transition-opacity group-hover:opacity-90"
                />
                <span className="border-t bg-background px-3 py-1.5 text-xs text-muted-foreground">{p.label}</span>
              </button>
            ))}
          </div>
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Handwritten sticky-note revision sheets made from this editorial: every approach (idea, steps, pseudocode,
            TC/SC, why it is faster) plus a cheat corner with a dry run, edge cases, pitfalls and how to spot the pattern.
          </p>
        )}
      </div>

      {viewerPage !== null && notes && pages.length > 0 && (
        <RevisionNotesViewer
          pages={pages}
          index={Math.min(viewerPage, pages.length - 1)}
          onIndexChange={setViewerPage}
          title={notes.title}
          onClose={() => setViewerPage(null)}
        />
      )}
    </div>
  );
}

/* ---------------------------- Safety check ------------------------------ */

const STATUS_UI = {
  passed: { icon: ShieldCheck, text: "Verified", cls: "border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400" },
  passed_with_warnings: { icon: ShieldCheck, text: "Verified with warnings", cls: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400" },
  needs_review: { icon: ShieldAlert, text: "Needs review", cls: "border-destructive/30 bg-destructive/5 text-destructive" },
  unverified: { icon: ShieldQuestion, text: "Not verified", cls: "border-border bg-muted/30 text-muted-foreground" },
} as const;

function SafetyCheck({
  audit,
  verifying,
  canVerify,
  onVerify,
}: {
  audit: RevisionAudit | null;
  verifying: boolean;
  canVerify: boolean;
  onVerify: () => void;
}) {
  const [open, setOpen] = useState(false);
  const key = !audit || audit.stale ? "unverified" : audit.status;
  const ui = STATUS_UI[key];
  const Icon = ui.icon;
  const passed = audit ? audit.checks.filter((c) => c.ok).length : 0;
  const errors = audit ? audit.issues.filter((i) => i.severity === "error").length : 0;
  const summary = !audit
    ? "These notes were made before the safety check existed."
    : audit.stale
      ? "Edited since the last safety check — re-verify before sharing."
      : `${passed}/${audit.checks.length} checks passed · ${audit.issues.length} review finding${audit.issues.length === 1 ? "" : "s"}${errors ? ` (${errors} error${errors === 1 ? "" : "s"})` : ""}${audit.repairs ? ` · auto-repaired ${audit.repairs}×` : ""}`;

  return (
    <div className={cn("rounded-md border text-xs", ui.cls)}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="font-semibold">Safety check: {ui.text}</span>
        <span className="text-muted-foreground">{summary}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {audit && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setOpen((v) => !v)}>
              <ChevronDown className={cn("mr-1 h-3 w-3 transition-transform", open && "rotate-180")} />
              {open ? "Hide report" : "Report"}
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" disabled={!canVerify} onClick={onVerify}>
            {verifying ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ShieldCheck className="mr-1 h-3 w-3" />}
            {audit ? "Re-verify" : "Verify"}
          </Button>
        </div>
      </div>
      {open && audit && (
        <div className="space-y-3 border-t border-inherit bg-background/60 px-3 py-2 text-foreground">
          <ul className="grid gap-1 sm:grid-cols-2">
            {audit.checks.map((c) => (
              <li key={c.id} className="flex gap-1.5">
                {c.ok ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                ) : (
                  <AlertTriangle className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", c.level === "error" ? "text-destructive" : "text-amber-600")} />
                )}
                <span>
                  {c.label}
                  {c.details.map((d, i) => (
                    <span key={i} className="block text-muted-foreground">– {d}</span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {audit.issues.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-semibold">Independent review ({audit.model})</p>
              {audit.issues.map((i, idx) => (
                <div key={idx} className="rounded border bg-background px-2 py-1.5">
                  <span className={cn("mr-1.5 rounded px-1 py-0.5 text-[10px] font-semibold uppercase", i.severity === "error" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-700 dark:text-amber-400")}>
                    {i.severity}
                  </span>
                  {i.path && <code className="mr-1.5 text-[11px] text-muted-foreground">{i.path}</code>}
                  {i.problem}
                  {i.fix && <span className="mt-0.5 block text-muted-foreground">Fix: {i.fix}</span>}
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Checked {audit.checkedAt ? new Date(audit.checkedAt).toLocaleString() : "—"}. Every image is drawn from these same
            checked notes, so titles, labels, complexities and names agree across pages.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Viewer --------------------------------- */

const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3];

function RevisionNotesViewer({
  pages,
  index,
  onIndexChange,
  title,
  onClose,
}: {
  pages: PageImage[];
  index: number;
  onIndexChange: (i: number) => void;
  title: string;
  onClose: () => void;
}) {
  const page = pages[index];
  const [zoomIdx, setZoomIdx] = useState(3);
  const [rotation, setRotation] = useState(0);
  // Natural size per image URL, so switching pages never shows a stale size.
  const [naturals, setNaturals] = useState<Record<string, { w: number; h: number }>>({});
  const natural = naturals[page.src] ?? null;
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (delta: number) => onIndexChange((index + delta + pages.length) % pages.length),
    [index, pages.length, onIndexChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (pages.length > 1 && e.key === "ArrowRight") go(1);
      if (pages.length > 1 && e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    // Keep the page behind the viewer from scrolling.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, go, pages.length]);

  // Measure the frame once it exists (and on resize) for fit-to-window.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrame({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const remember = useCallback((src: string, img: HTMLImageElement) => {
    if (img.naturalWidth > 0) {
      setNaturals((prev) =>
        prev[src] ? prev : { ...prev, [src]: { w: img.naturalWidth, h: img.naturalHeight } },
      );
    }
  }, []);

  // The thumbnail already loaded this exact URL, so the browser can serve it
  // from memory cache and finish loading before React attaches onLoad (seen in
  // Safari) — the image then stayed hidden forever. Read the size as soon as
  // the element exists if it is already complete; onLoad covers the rest.
  const measure = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete) remember(page.src, img);
    },
    [remember, page.src],
  );

  const sideways = rotation % 180 !== 0;
  // "100%" means fit-to-window; zoom steps scale from there.
  const fit =
    natural && frame
      ? Math.min(
          (frame.w - 32) / (sideways ? natural.h : natural.w),
          (frame.h - 32) / (sideways ? natural.w : natural.h),
          1,
        )
      : 1;
  const scale = fit * ZOOM_STEPS[zoomIdx];
  const boxW = natural ? (sideways ? natural.h : natural.w) * scale : 0;
  const boxH = natural ? (sideways ? natural.w : natural.h) * scale : 0;

  // Portal to <body>: every page sits inside PageTransition, whose inline
  // `transform` makes it the containing block for `position: fixed` — without
  // the portal the overlay is centred on the (tall) page, not the viewport,
  // and opens off-screen.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Revision notes image"
        className="flex h-full max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">Revision notes · {title}</span>
            {pages.length > 1 && (
              <div className="flex items-center gap-0.5 rounded-md border p-0.5">
                {pages.map((p, i) => (
                  <button
                    key={p.src}
                    type="button"
                    onClick={() => onIndexChange(i)}
                    className={cn(
                      "rounded px-2 py-0.5 text-xs",
                      i === index ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {pages.length > 1 && (
              <>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="Previous page" onClick={() => go(-1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="Next page" onClick={() => go(1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Zoom out"
              disabled={zoomIdx === 0} onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
              {Math.round(ZOOM_STEPS[zoomIdx] * 100)}%
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Zoom in"
              disabled={zoomIdx === ZOOM_STEPS.length - 1}
              onClick={() => setZoomIdx((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Rotate"
              onClick={() => setRotation((r) => (r + 90) % 360)}>
              <RotateCw className="h-4 w-4" />
            </Button>
            <a href={page.downloadUrl} title="Download this page"
              className={buttonVariants({ variant: "ghost", size: "icon", className: "h-8 w-8" })}>
              <Download className="h-4 w-4" />
            </a>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div ref={frameRef} className="flex min-h-0 flex-1 overflow-auto bg-muted/40 p-4">
          <div className="m-auto flex shrink-0 items-center justify-center" style={{ width: boxW, height: boxH }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- dynamic, auth-gated PNG */}
            <img
              key={page.src}
              ref={measure}
              src={page.src}
              alt={`Revision notes page ${page.label}: ${title}`}
              onLoad={(e) => remember(page.src, e.currentTarget)}
              className="max-w-none rounded-md shadow-md"
              style={{
                width: natural ? natural.w * scale : undefined,
                transform: `rotate(${rotation}deg)`,
                visibility: natural ? "visible" : "hidden",
              }}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------- Editor --------------------------------- */

const inputCls =
  "w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary";

function Field({
  label,
  value,
  onChange,
  multiline,
  mono,
  rows = 2,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  mono?: boolean;
  rows?: number;
  hint?: string;
}) {
  return (
    <label className="block space-y-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
        {hint && <span className="ml-1 normal-case tracking-normal opacity-70">({hint})</span>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          rows={rows}
          spellCheck={!mono}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputCls, "resize-y leading-snug", mono && "font-mono")}
        />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      )}
    </label>
  );
}

/** Code steps, one per line; keeps the raw text so a new empty line survives typing. */
function StepsField({ value, onChange }: { value: string[]; onChange: (text: string) => void }) {
  const [text, setText] = useState(() => value.join("\n"));
  return (
    <Field
      label="Code steps"
      hint="one per line, use the editorial's names"
      multiline
      rows={5}
      value={text}
      onChange={(v) => {
        setText(v);
        onChange(v);
      }}
    />
  );
}

/** Lists are edited one item per line; the dry-run table one row per line, cells split by "|". */
const toLines = (items: string[]) => items.join("\n");
const fromLines = (text: string) => text.split("\n").map((s) => s.trim()).filter(Boolean);
const toRows = (rows: string[][]) => rows.map((r) => r.join(" | ")).join("\n");
const fromRows = (text: string) =>
  text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => l.split("|").map((c) => c.trim()));

function RevisionNotesEditor({
  problemId,
  draft,
  onChange,
  onCancel,
  onSaved,
}: {
  problemId: string;
  draft: RevisionNotes;
  onChange: (next: RevisionNotes) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Raw text for the list-shaped fields, so typing a trailing newline or "|"
  // is not normalised away mid-edit. Parsed into the draft on every change.
  const [tagsText, setTagsText] = useState(() => draft.tags.join(", "));
  const [rowsText, setRowsText] = useState(() => toRows(draft.dryRun?.rows ?? []));
  const [columnsText, setColumnsText] = useState(() => (draft.dryRun?.columns ?? []).join(", "));

  useEffect(
    () => () => {
      previews.forEach((u) => URL.revokeObjectURL(u));
    },
    [previews],
  );

  const set = <K extends keyof RevisionNotes>(field: K, value: RevisionNotes[K]) =>
    onChange({ ...draft, [field]: value });
  const setSteps = (i: number, text: string) =>
    onChange({
      ...draft,
      approaches: draft.approaches.map((a, j) => (j === i ? { ...a, steps: fromLines(text) } : a)),
    });
  const setApproach = (i: number, field: Exclude<keyof RevisionApproach, "steps" | "solutionIndex">, value: string) =>
    onChange({
      ...draft,
      approaches: draft.approaches.map((a, j) => (j === i ? { ...a, [field]: value } : a)),
    });
  const emptyDryRun: DryRun = { approach: draft.approaches.at(-1)?.label ?? "", input: "", columns: [], rows: [], result: "" };
  const setDry = (patch: Partial<DryRun>) => set("dryRun", { ...(draft.dryRun ?? emptyDryRun), ...patch });

  const check = (): RevisionNotes | null => {
    const parsed = parseRevisionNotes(draft);
    if (!parsed.ok) {
      setError(parsed.errors.join("; "));
      return null;
    }
    setError(null);
    return parsed.notes;
  };

  const preview = async () => {
    const notes = check();
    if (!notes) return;
    setBusy("preview");
    try {
      const urls: string[] = [];
      for (let i = 1; i <= revisionPages(notes).length; i++) {
        const res = await fetch(`/api/problems/${encodeURIComponent(problemId)}/revision-notes/image?page=${i}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(notes),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Preview failed");
        urls.push(URL.createObjectURL(await res.blob()));
      }
      setPreviews(urls);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    const notes = check();
    if (!notes) return;
    setBusy("save");
    try {
      const res = await fetch(`/api/files/save?problemId=${encodeURIComponent(problemId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Edited notes are no longer what the safety check verified.
        body: JSON.stringify({
          path: REVISION_NOTES_FILE,
          content: `${JSON.stringify({ ...notes, audit: notes.audit ? { ...notes.audit, stale: true } : null }, null, 2)}\n`,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  };

  const dr = draft.dryRun;

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h4 className="text-xs font-semibold">Header</h4>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Title" value={draft.title} onChange={(v) => set("title", v)} />
          <Field label="One-liner" value={draft.oneLiner} onChange={(v) => set("oneLiner", v)} />
          <Field label="Example" hint="input → output" value={draft.example} onChange={(v) => set("example", v)} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field
            label="Tags"
            hint="comma-separated"
            value={tagsText}
            onChange={(v) => {
              setTagsText(v);
              set("tags", v.split(",").map((t) => t.trim()).filter(Boolean));
            }}
          />
          <Field label="Constraints hint" value={draft.constraintsHint} onChange={(v) => set("constraintsHint", v)} />
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold">Page 1 · Approaches</h4>
        <div className={cn("grid gap-3", draft.approaches.length > 1 && "lg:grid-cols-2", draft.approaches.length > 2 && "xl:grid-cols-3")}>
          {draft.approaches.map((a, i) => (
            <div key={i} className="space-y-2 rounded-md border bg-muted/20 p-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Note label" value={a.label} onChange={(v) => setApproach(i, "label", v)} />
                <Field label="Technique" value={a.name} onChange={(v) => setApproach(i, "name", v)} />
              </div>
              {i > 0 && (
                <Field
                  label="Why it's better"
                  hint="shown on the arrow"
                  multiline
                  value={a.whyBetter}
                  onChange={(v) => setApproach(i, "whyBetter", v)}
                />
              )}
              <Field label="The idea" multiline value={a.intuition} onChange={(v) => setApproach(i, "intuition", v)} />
              <StepsField value={a.steps} onChange={(v) => setSteps(i, v)} />
              {/* Legacy notes (before code steps) still carry a pseudocode; editable until regenerated. */}
              {!a.steps.length && a.pseudocode && (
                <Field label="Pseudocode (legacy)" multiline mono rows={7} value={a.pseudocode} onChange={(v) => setApproach(i, "pseudocode", v)} />
              )}
              <div className="grid grid-cols-2 gap-2">
                <Field label="Time" value={a.tc} onChange={(v) => setApproach(i, "tc", v)} />
                <Field label="Space" value={a.sc} onChange={(v) => setApproach(i, "sc", v)} />
              </div>
              <Field label="Remember" multiline value={a.takeaway} onChange={(v) => setApproach(i, "takeaway", v)} />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold">Page 2 · Cheat corner</h4>
        <div className="grid gap-2 lg:grid-cols-3">
          <Field label="Spot the pattern" hint="one per line" multiline rows={4}
            value={toLines(draft.recognize)} onChange={(v) => set("recognize", fromLines(v))} />
          <Field label="Edge cases" hint="one per line" multiline rows={4}
            value={toLines(draft.edgeCases)} onChange={(v) => set("edgeCases", fromLines(v))} />
          <Field label="Pitfalls" hint="one per line" multiline rows={4}
            value={toLines(draft.pitfalls)} onChange={(v) => set("pitfalls", fromLines(v))} />
        </div>
        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Dry run</span>
            {dr ? (
              <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => set("dryRun", null)}>
                Remove dry run
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => set("dryRun", emptyDryRun)}>
                Add dry run
              </Button>
            )}
          </div>
          {dr && (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Approach traced" value={dr.approach} onChange={(v) => setDry({ approach: v })} />
                <Field label="Input" value={dr.input} onChange={(v) => setDry({ input: v })} />
                <Field label="Result" value={dr.result} onChange={(v) => setDry({ result: v })} />
              </div>
              <Field
                label="Columns"
                hint="comma-separated"
                value={columnsText}
                onChange={(v) => {
                  setColumnsText(v);
                  setDry({ columns: v.split(",").map((c) => c.trim()).filter(Boolean) });
                }}
              />
              <Field
                label="Rows"
                hint='one row per line, cells separated by "|"'
                multiline
                mono
                rows={6}
                value={rowsText}
                onChange={(v) => {
                  setRowsText(v);
                  setDry({ rows: fromRows(v) });
                }}
              />
            </>
          )}
        </div>
      </section>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Button variant="ghost" size="sm" className="h-8" onClick={onCancel} disabled={busy !== null}>
          Cancel
        </Button>
        <Button variant="outline" size="sm" className="h-8" onClick={preview} disabled={busy !== null}>
          {busy === "preview" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Eye className="mr-1.5 h-3.5 w-3.5" />}
          Preview
        </Button>
        <Button size="sm" className="h-8" onClick={save} disabled={busy !== null}>
          {busy === "save" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
          Save
        </Button>
      </div>

      {previews.length > 0 && (
        <div className="space-y-3">
          {previews.map((url, i) => (
            <div key={url} className="overflow-hidden rounded-md border bg-[#f6f3ec]">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
              <img src={url} alt={`Revision notes preview, page ${i + 1}`} className="mx-auto w-full max-w-5xl" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
