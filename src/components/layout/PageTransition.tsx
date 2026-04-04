"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useRef } from "react";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [phase, setPhase] = useState<"enter" | "visible">("visible");
  const prevPathname = useRef(pathname);

  useEffect(() => {
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;
      setPhase("enter");
      // Double rAF ensures the browser paints the "enter" state first
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setPhase("visible");
        });
      });
    }
  }, [pathname]);

  return (
    <div
      style={{
        opacity: phase === "enter" ? 0 : 1,
        transform: phase === "enter" ? "translateY(8px)" : "translateY(0)",
        transition: "opacity 300ms ease-out, transform 300ms ease-out",
      }}
    >
      {children}
    </div>
  );
}
