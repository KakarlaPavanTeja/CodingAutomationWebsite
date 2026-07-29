"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Maximize2, Minimize2 } from "lucide-react";

type PanelFocus = "split" | "left" | "right";

const SPLIT_STORAGE_KEY = "pipeline-split-ratio";
const DEFAULT_SPLIT = 58;
const MIN_LEFT_PX = 220;
const MIN_RIGHT_PX = 260;
const PANEL_MS = 520;
const PANEL_EASE = "cubic-bezier(0.33, 1, 0.68, 1)";

const widthTransition = `width ${PANEL_MS}ms ${PANEL_EASE}`;
const fadeTransition = `opacity ${PANEL_MS}ms ${PANEL_EASE}, transform ${PANEL_MS}ms ${PANEL_EASE}`;

interface PanelChromeProps {
  title?: ReactNode;
  actions?: ReactNode;
  focus: PanelFocus;
  side: "left" | "right";
  collapsed: boolean;
  onMaximize: () => void;
  onRestore: () => void;
  className?: string;
  children: ReactNode;
}

function PanelChrome({
  title,
  actions,
  focus,
  side,
  collapsed,
  onMaximize,
  onRestore,
  className,
  children,
}: PanelChromeProps) {
  const isMaximized = focus === side;
  const showMaximize = focus === "split";

  return (
    <div
      className={cn(
        "flex flex-col min-h-0 min-w-0 h-full overflow-hidden",
        collapsed && "pointer-events-none",
        className
      )}
      style={{
        opacity: collapsed ? 0 : 1,
        transform: collapsed ? "scale(0.985)" : "scale(1)",
        transition: fadeTransition,
      }}
    >
      <div className="flex items-start justify-between gap-2 shrink-0 mb-1.5">
        <div className="min-w-0 flex-1">{title}</div>
        <div className="flex items-center gap-1.5 shrink-0">
          {actions}
          {(showMaximize || isMaximized) && (
            <button
              type="button"
              title={isMaximized ? "Restore split view" : "Maximize panel"}
              aria-label={isMaximized ? "Restore split view" : "Maximize panel"}
              onClick={isMaximized ? onRestore : onMaximize}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60",
                "text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors duration-200"
              )}
            >
              {isMaximized ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

const PANEL_HEIGHT = "min(62vh, 560px)";

interface PipelineSplitLayoutProps {
  left: ReactNode;
  right: ReactNode;
  leftTitle?: ReactNode;
  rightTitle?: ReactNode;
  leftActions?: ReactNode;
  rightActions?: ReactNode;
  className?: string;
}

function panelWidth(focus: PanelFocus, splitPercent: number, side: "left" | "right"): string {
  if (focus === "left") return side === "left" ? "100%" : "0%";
  if (focus === "right") return side === "right" ? "100%" : "0%";
  return side === "left" ? `${splitPercent}%` : `${100 - splitPercent}%`;
}

export function PipelineSplitLayout({
  left,
  right,
  leftTitle,
  rightTitle,
  leftActions,
  rightActions,
  className,
}: PipelineSplitLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<PanelFocus>("split");
  // Restore the stored split in the initializer, not a mount effect: the effect version
  // laid the panes out at the default and jumped to the saved width on the next frame.
  const [splitPercent, setSplitPercent] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_SPLIT;
    try {
      const n = Number(localStorage.getItem(SPLIT_STORAGE_KEY));
      return !Number.isNaN(n) && n >= 25 && n <= 75 ? n : DEFAULT_SPLIT;
    } catch {
      return DEFAULT_SPLIT;
    }
  });
  const [isDragging, setIsDragging] = useState(false);
  const splitBeforeMaxRef = useRef(DEFAULT_SPLIT);

  const persistSplit = useCallback((value: number) => {
    try {
      localStorage.setItem(SPLIT_STORAGE_KEY, String(Math.round(value)));
    } catch {
      /* ignore */
    }
  }, []);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      if (focus !== "split") return;
      e.preventDefault();
      setIsDragging(true);
    },
    [focus]
  );

  useEffect(() => {
    if (!isDragging) return;

    const onMove = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.width;
      if (total <= 0) return;

      const minLeft = (MIN_LEFT_PX / total) * 100;
      const maxLeft = 100 - (MIN_RIGHT_PX / total) * 100;
      const next = Math.min(maxLeft, Math.max(minLeft, ((e.clientX - rect.left) / total) * 100));
      setSplitPercent(next);
    };

    const onUp = () => {
      setIsDragging(false);
      setSplitPercent((current) => {
        persistSplit(current);
        return current;
      });
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, persistSplit]);

  const maximizeLeft = () => {
    if (focus === "split") splitBeforeMaxRef.current = splitPercent;
    setFocus("left");
  };

  const maximizeRight = () => {
    if (focus === "split") splitBeforeMaxRef.current = splitPercent;
    setFocus("right");
  };

  const restoreSplit = () => {
    setFocus("split");
    setSplitPercent(splitBeforeMaxRef.current);
  };

  const isSplit = focus === "split";
  const leftCollapsed = focus === "right";
  const rightCollapsed = focus === "left";
  const noTransition = isDragging;

  const shellStyle = (side: "left" | "right"): CSSProperties => ({
    width: panelWidth(focus, splitPercent, side),
    flexShrink: 0,
    minWidth: 0,
    overflow: "hidden",
    transition: noTransition ? "none" : widthTransition,
  });

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          "relative hidden xl:flex w-full items-stretch overflow-hidden min-h-[300px]",
          isDragging && "select-none",
          className
        )}
        style={{ height: PANEL_HEIGHT, maxHeight: PANEL_HEIGHT }}
      >
        <div style={shellStyle("left")} className="h-full min-h-0 flex flex-col">
          <PanelChrome
            title={leftTitle}
            actions={leftActions}
            focus={focus}
            side="left"
            collapsed={leftCollapsed}
            onMaximize={maximizeLeft}
            onRestore={restoreSplit}
            className={isSplit ? "pr-2" : undefined}
          >
            {left}
          </PanelChrome>
        </div>

        <div style={shellStyle("right")} className="h-full min-h-0 flex flex-col">
          <PanelChrome
            title={rightTitle}
            actions={rightActions}
            focus={focus}
            side="right"
            collapsed={rightCollapsed}
            onMaximize={maximizeRight}
            onRestore={restoreSplit}
            className={isSplit ? "pl-2" : undefined}
          >
            {right}
          </PanelChrome>
        </div>

        {/* Overlay handle — keeps panel widths as pure % for smooth CSS transitions */}
        <div
          className={cn(
            "absolute inset-y-0 z-10 flex w-4 -translate-x-1/2 items-center justify-center",
            !isSplit && "pointer-events-none"
          )}
          style={{
            left: `${splitPercent}%`,
            opacity: isSplit ? 1 : 0,
            transition: noTransition
              ? "none"
              : `left ${PANEL_MS}ms ${PANEL_EASE}, opacity ${PANEL_MS * 0.55}ms ease`,
          }}
          onMouseDown={startDrag}
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={Math.round(splitPercent)}
          aria-hidden={!isSplit}
          aria-label="Resize panels"
        >
          <div className="absolute inset-y-3 left-1/2 -translate-x-1/2 w-px bg-border" />
          <div
            className={cn(
              "relative z-10 h-12 w-1.5 rounded-full bg-muted-foreground/25",
              isSplit && "cursor-col-resize hover:bg-primary/60 active:bg-primary transition-colors duration-200"
            )}
          />
        </div>
      </div>

      <div className={cn("flex flex-col gap-3 xl:hidden min-h-[300px]", className)}>
        {(focus === "split" || focus === "left") && (
          <div className="min-w-0">
            <PanelChrome
              title={leftTitle}
              actions={leftActions}
              focus={focus}
              side="left"
              collapsed={false}
              onMaximize={maximizeLeft}
              onRestore={restoreSplit}
            >
              {left}
            </PanelChrome>
          </div>
        )}
        {(focus === "split" || focus === "right") && (
          <div className="min-w-0 min-h-[320px] max-h-[min(62vh,560px)] flex flex-col">
            <PanelChrome
              title={rightTitle}
              actions={rightActions}
              focus={focus}
              side="right"
              collapsed={false}
              onMaximize={maximizeRight}
              onRestore={restoreSplit}
            >
              {right}
            </PanelChrome>
          </div>
        )}
      </div>
    </>
  );
}
