"use client";

import { useRouter } from "next/navigation";
import { FileUploader } from "@/components/files/FileUploader";
import { usePipeline } from "@/lib/pipeline-context";
import { useToast } from "@/components/ui/toast";

export default function PipelinePage() {
  const { setCurrentProblemId } = usePipeline();
  const router = useRouter();
  const { toast } = useToast();

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Problem</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload your problem files to start the automation pipeline
        </p>
      </div>

      <FileUploader
        onUploadComplete={(problemId) => {
          if (problemId) {
            setCurrentProblemId(problemId);
            toast("Problem uploaded! Redirecting to pipeline...", "success");
            router.push(`/problems/${problemId}`);
          }
        }}
      />
    </div>
  );
}
