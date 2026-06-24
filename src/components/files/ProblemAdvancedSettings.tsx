"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MemberPicker } from "@/components/problems/MemberAccess";
import { cn } from "@/lib/utils";

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
        selected
          ? "bg-foreground text-background border-foreground"
          : "bg-transparent text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

interface ProblemAdvancedSettingsProps {
  mode: "practice" | "exam";
  scenarioLevel: "none" | "light" | "moderate" | "heavy";
  onScenarioLevelChange: (value: "none" | "light" | "moderate" | "heavy") => void;
  difficulty: "" | "easy" | "medium" | "hard";
  onDifficultyChange: (value: "" | "easy" | "medium" | "hard") => void;
  score: string;
  onScoreChange: (value: string) => void;
  companies: string;
  onCompaniesChange: (value: string) => void;
  sharedMemberIds: string[];
  onSharedMemberIdsChange: (ids: string[]) => void;
}

export function ProblemAdvancedSettings({
  mode,
  scenarioLevel,
  onScenarioLevelChange,
  difficulty,
  onDifficultyChange,
  score,
  onScoreChange,
  companies,
  onCompaniesChange,
  sharedMemberIds,
  onSharedMemberIdsChange,
}: ProblemAdvancedSettingsProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">Advanced settings</h2>
        <p className="text-sm text-muted-foreground">
          Optional metadata and sharing. You can skip these — defaults work for most problems.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Scenario level</CardTitle>
            <CardDescription>How much real-world context to weave into the description.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {(["none", "light", "moderate", "heavy"] as const).map((s) => (
                <Chip key={s} selected={scenarioLevel === s} onClick={() => onScenarioLevelChange(s)}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </Chip>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Difficulty</CardTitle>
            <CardDescription>Leave on Auto to let the pipeline infer it from the solution.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {(["", "easy", "medium", "hard"] as const).map((d) => (
                <Chip key={d || "auto"} selected={difficulty === d} onClick={() => onDifficultyChange(d)}>
                  {d || "Auto"}
                </Chip>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Score</CardTitle>
            <CardDescription>Total points for the problem. Auto uses 20 / 25 / 30 by difficulty.</CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              type="number"
              min={1}
              max={100000}
              placeholder="Auto (20 / 25 / 30)"
              value={score}
              onChange={(e) => onScoreChange(e.target.value)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Share with members</CardTitle>
            <CardDescription>Grant other team members access to this problem.</CardDescription>
          </CardHeader>
          <CardContent>
            <MemberPicker selected={sharedMemberIds} onChange={onSharedMemberIdsChange} />
          </CardContent>
        </Card>

        {mode === "practice" && (
          <Card className="sm:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Companies</CardTitle>
              <CardDescription>One company per line. Used for practice-mode tagging.</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={companies}
                onChange={(e) => onCompaniesChange(e.target.value)}
                placeholder={"Google\nAmazon\nMeta"}
                className="min-h-[100px] font-mono text-sm resize-y"
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
