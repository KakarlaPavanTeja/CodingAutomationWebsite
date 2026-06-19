"use client";

import { useState, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FileUploaderProps {
  onUploadComplete?: (problemId?: string) => void;
}

const PROBLEM_TYPES = [
  { id: "standard", label: "Standard" },
  { id: "linked_list", label: "Linked List" },
  { id: "binary_tree", label: "Binary Tree" },
];

const QUESTION_TYPES = [
  { id: "function", label: "Function-based" },
  { id: "nonfunction", label: "Non-function" },
];

const MODES = [
  { id: "practice", label: "Practice" },
  { id: "exam", label: "Exam" },
];

const SOLUTION_LANGUAGES = [
  { id: "py", label: "Python", ext: ".py", recommended: true },
  { id: "cpp", label: "C++", ext: ".cpp" },
  { id: "java", label: "Java", ext: ".java" },
  { id: "js", label: "Node.js", ext: ".js" },
];

type InputMode = "paste" | "file";

export function FileUploader({ onUploadComplete }: FileUploaderProps) {
  const [problemFile, setProblemFile] = useState<File | null>(null);
  const [solutionFile, setSolutionFile] = useState<File | null>(null);
  const [problemText, setProblemText] = useState("");
  const [solutionText, setSolutionText] = useState("");
  const [solutionLang, setSolutionLang] = useState("py");
  const [problemInputMode, setProblemInputMode] = useState<InputMode>("paste");
  const [solutionInputMode, setSolutionInputMode] = useState<InputMode>("paste");
  const [problemName, setProblemName] = useState("");
  const [problemType, setProblemType] = useState("standard");
  const [questionType, setQuestionType] = useState("function");
  const [mode, setMode] = useState("practice");
  const [scenarioLevel, setScenarioLevel] = useState<"none" | "light" | "moderate" | "heavy">("none");
  const [difficulty, setDifficulty] = useState<"" | "easy" | "medium" | "hard">("");
  const [score, setScore] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();

    const validExts = SOLUTION_LANGUAGES.map((l) => l.ext);
    for (const file of Array.from(e.dataTransfer.files)) {
      if (file.name === "problem.md" || file.name.endsWith(".md")) {
        setProblemFile(file);
        setProblemInputMode("file");
      } else if (validExts.some((ext) => file.name.endsWith(ext))) {
        setSolutionFile(file);
        setSolutionInputMode("file");
      }
    }
  }, []);

  const hasProblemContent = problemInputMode === "paste" ? problemText.trim().length > 0 : !!problemFile;
  const hasSolutionContent = solutionInputMode === "paste" ? solutionText.trim().length > 0 : !!solutionFile;

  const handleUpload = async () => {
    if (!hasProblemContent && !hasSolutionContent) return;
    if (!problemName.trim()) {
      setError("Problem name is required");
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append("problemName", problemName.trim());
    formData.append("problemType", problemType);
    formData.append("questionType", questionType);
    formData.append("mode", mode);
    formData.append("scenarioLevel", scenarioLevel);
    if (difficulty) formData.append("difficulty", difficulty);
    if (score.trim()) formData.append("score", score.trim());

    // Problem description
    if (problemInputMode === "paste" && problemText.trim()) {
      const blob = new Blob([problemText], { type: "text/markdown" });
      formData.append("problemMd", blob, "problem.md");
    } else if (problemInputMode === "file" && problemFile) {
      formData.append("problemMd", problemFile);
    }

    // Solution code
    if (solutionInputMode === "paste" && solutionText.trim()) {
      const ext = SOLUTION_LANGUAGES.find((l) => l.id === solutionLang)?.ext || ".py";
      const blob = new Blob([solutionText], { type: "text/plain" });
      formData.append("solution", blob, `solution${ext}`);
    } else if (solutionInputMode === "file" && solutionFile) {
      formData.append("solution", solutionFile);
    }

    try {
      const res = await fetch("/api/files/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUploaded(data.uploaded);
      onUploadComplete?.(data.problemId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Create New Problem</CardTitle>
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
              <span className="text-sm font-medium">Question Type</span>
              <div className="flex gap-1.5">
                {QUESTION_TYPES.map((qt) => (
                  <button
                    key={qt.id}
                    type="button"
                    onClick={() => setQuestionType(qt.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                      questionType === qt.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-muted"
                    )}
                  >
                    {qt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Mode</span>
              <div className="flex gap-1.5">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                      mode === m.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-muted"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6">
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

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Difficulty</span>
              <div className="flex gap-1.5">
                {([
                  { id: "", label: "AI's choice" },
                  { id: "easy", label: "Easy" },
                  { id: "medium", label: "Medium" },
                  { id: "hard", label: "Hard" },
                ] as const).map((opt) => (
                  <button
                    key={opt.id || "none"}
                    type="button"
                    onClick={() => setDifficulty(opt.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                      difficulty === opt.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-muted"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="problem-score" className="text-sm font-medium">Score</Label>
              <Input
                id="problem-score"
                type="number"
                min={1}
                max={100000}
                placeholder="e.g. 100"
                value={score}
                onChange={(e) => setScore(e.target.value)}
                className="w-28"
              />
            </div>
          </div>
        </div>

        {/* Problem Description */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Problem Description</Label>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setProblemInputMode("paste")}
                className={cn(
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  problemInputMode === "paste"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                Paste
              </button>
              <button
                type="button"
                onClick={() => setProblemInputMode("file")}
                className={cn(
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  problemInputMode === "file"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                Upload File
              </button>
            </div>
          </div>

          {problemInputMode === "paste" ? (
            <textarea
              value={problemText}
              onChange={(e) => setProblemText(e.target.value)}
              placeholder="Paste your problem description here (markdown supported)..."
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[160px] resize-y font-mono"
            />
          ) : (
            <div
              className="border-2 border-dashed rounded-lg p-4 text-center transition-colors border-muted-foreground/25 hover:border-muted-foreground/50"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
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
            </div>
          )}
        </div>

        {/* Solution Code */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Solution Code</Label>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setSolutionInputMode("paste")}
                className={cn(
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  solutionInputMode === "paste"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                Paste
              </button>
              <button
                type="button"
                onClick={() => setSolutionInputMode("file")}
                className={cn(
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  solutionInputMode === "file"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                Upload File
              </button>
            </div>
          </div>

          {solutionInputMode === "paste" ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {SOLUTION_LANGUAGES.map((lang) => (
                  <button
                    key={lang.id}
                    type="button"
                    onClick={() => setSolutionLang(lang.id)}
                    className={cn(
                      "px-2.5 py-1 rounded text-xs font-medium transition-colors border",
                      solutionLang === lang.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-muted"
                    )}
                  >
                    {lang.label}
                    {lang.recommended && <span className="ml-1 text-[10px] opacity-75">*</span>}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">* Python is highly recommended — it properly defines input & output format</p>
              <textarea
                value={solutionText}
                onChange={(e) => setSolutionText(e.target.value)}
                placeholder="Paste your solution code here..."
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[160px] resize-y font-mono"
              />
            </div>
          ) : (
            <div
              className="border-2 border-dashed rounded-lg p-4 text-center transition-colors border-muted-foreground/25 hover:border-muted-foreground/50"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
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
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleUpload}
            disabled={uploading || (!hasProblemContent && !hasSolutionContent)}
          >
            {uploading ? "Creating..." : "Create Problem"}
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
