"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FileUploader } from "@/components/files/FileUploader";
import { usePipeline } from "@/lib/pipeline-context";
import { useToast } from "@/components/ui/toast";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NewProblemPage() {
  const { setCurrentProblemId } = usePipeline();
  const router = useRouter();
  const { toast } = useToast();

  return (
    <div className="min-h-[calc(100vh-4rem)] animate-in fade-in duration-300">
      <div className="border-b bg-muted/20">
        <div className="container mx-auto px-4 py-3">
          <Link
            href="/problems"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-muted-foreground")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Problems
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8">
        <FileUploader
          onCancel={() => router.push("/problems")}
          onUploadComplete={(problemId) => {
            if (problemId) {
              setCurrentProblemId(problemId);
              toast("Problem created! Opening pipeline…", "success");
              router.push(`/problems/${problemId}`);
            }
          }}
        />
      </div>
    </div>
  );
}
