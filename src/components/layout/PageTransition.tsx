"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [trackedPathname, setTrackedPathname] = useState(pathname);
  const [phase, setPhase] = useState<"enter" | "visible">("visible");

  // React-canonical pattern: derive state from props during render.
  // When the route changes, schedule an "enter" phase before the next paint.
  if (trackedPathname !== pathname) {
    setTrackedPathname(pathname);
    setPhase("enter");
  }

  useEffect(() => {
    if (phase !== "enter") return;
    // Double rAF ensures the browser paints the "enter" state first
    let r2: number | null = null;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setPhase("visible"));
    });
    return () => {
      cancelAnimationFrame(r1);
      if (r2 !== null) cancelAnimationFrame(r2);
    };
  }, [phase]);

  return (
    <div
      style={{
        opacity: phase === "enter" ? 0 : 1,
        transform: phase === "enter" ? "translateY(4px)" : "translateY(0)",
        transition: "opacity 120ms ease-out, transform 120ms ease-out",
      }}
    >
      {children}
    </div>
  );
}
