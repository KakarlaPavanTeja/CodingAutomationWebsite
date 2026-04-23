"use client";

import { ThemeProvider } from "next-themes";
import { PipelineProvider } from "@/lib/pipeline-context";
import { AuthProvider } from "@/lib/auth-context";
import { ProblemsProvider } from "@/lib/problems-context";
import { ToastProvider } from "@/components/ui/toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ToastProvider>
        <AuthProvider>
          <ProblemsProvider>
            <PipelineProvider>{children}</PipelineProvider>
          </ProblemsProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
