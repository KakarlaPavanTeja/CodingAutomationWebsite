"use client";

import { ThemeProvider } from "next-themes";
import { PipelineProvider } from "@/lib/pipeline-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <PipelineProvider>{children}</PipelineProvider>
    </ThemeProvider>
  );
}
