"use client";

import { useState, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface FileUploaderProps {
  onUploadComplete?: () => void;
}

const PROBLEM_TYPES = [
  { id: "standard", label: "Standard" },
  { id: "linked_list", label: "Linked List" },
  { id: "binary_tree", label: "Binary Tree" },
];

export function FileUploader({ onUploadComplete }: FileUploaderProps) {
  const [problemFile, setProblemFile] = useState<File | null>(null);
  const [solutionFile, setSolutionFile] = useState<File | null>(null);
  const [problemName, setProblemName] = useState("");
  const [problemType, setProblemType] = useState("standard");
  const [scenarioLevel, setScenarioLevel] = useState<"none" | "light" | "moderate" | "heavy">("none");
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    for (const file of Array.from(e.dataTransfer.files)) {
      if (file.name === "problem.md" || file.name.endsWith(".md")) {
        setProblemFile(file);
      } else if (/\.(py|cpp|java|js)$/.test(file.name)) {
        setSolutionFile(file);
      }
    }
  }, []);

  const handleUpload = async () => {
    if (!problemFile && !solutionFile) return;
    if (!problemName.trim()) {
      setError("Problem name is required");
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();
    if (problemFile) formData.append("problemMd", problemFile);
    if (solutionFile) formData.append("solution", solutionFile);
    formData.append("problemName", problemName.trim());
    formData.append("problemType", problemType);
    formData.append("scenarioLevel", scenarioLevel);

    try {
      const res = await fetch("/api/files/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUploaded(data.uploaded);
      onUploadComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Upload Inputs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Problem Metadata */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="problem-name" className="text-sm">Problem Name</Label>
            <Input
              id="problem-name"
              placeholder="e.g. Two Sum"
              value={problemName}
              onChange={(e) => setProblemName(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Type</span>
              <div className="flex gap-1.5">
                {PROBLEM_TYPES.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => setProblemType(type.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                      problemType === type.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-muted"
                    )}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Scenario</span>
              <div className="flex gap-1.5">
                {([
                  { id: "none", label: "None" },
                  { id: "light", label: "Light" },
                  { id: "moderate", label: "Moderate" },
                  { id: "heavy", label: "Heavy" },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setScenarioLevel(opt.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                      scenarioLevel === opt.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-muted"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* File Drop Zone */}
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            dragOver
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <p className="text-sm text-muted-foreground mb-2">
            Drag & drop files here, or select below
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".md"
                className="hidden"
                onChange={(e) => setProblemFile(e.target.files?.[0] || null)}
              />
              <Badge variant="outline" className="cursor-pointer hover:bg-muted">
                {problemFile ? problemFile.name : "Select problem.md"}
              </Badge>
            </label>
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".py,.cpp,.java,.js"
                className="hidden"
                onChange={(e) => setSolutionFile(e.target.files?.[0] || null)}
              />
              <Badge variant="outline" className="cursor-pointer hover:bg-muted">
                {solutionFile ? solutionFile.name : "Select solution file"}
              </Badge>
            </label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleUpload}
            disabled={uploading || (!problemFile && !solutionFile)}
          >
            {uploading ? "Uploading..." : "Upload"}
          </Button>

          {uploaded.length > 0 && (
            <div className="flex gap-1">
              {uploaded.map((name) => (
                <Badge key={name} variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                  {name}
                </Badge>
              ))}
            </div>
          )}

          {error && <span className="text-sm text-red-500">{error}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
