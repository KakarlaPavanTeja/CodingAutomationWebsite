"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LANGUAGES, STEP_CONFIGS } from "@/lib/pipeline-config";
import type { StepId } from "@/types/pipeline";

interface GlobalConfigProps {
  languages: string[];
  onLanguagesChange: (langs: string[]) => void;
  testcaseCount: number;
  onTestcaseCountChange: (count: number) => void;
  enabledSubSteps: Map<StepId, string[]>;
  onSubStepToggle: (stepId: StepId, subStepId: string, enabled: boolean) => void;
  disabled?: boolean;
}

export function GlobalConfig({
  languages,
  onLanguagesChange,
  testcaseCount,
  onTestcaseCountChange,
  enabledSubSteps,
  onSubStepToggle,
  disabled,
}: GlobalConfigProps) {
  const toggleLanguage = (id: string, enabled: boolean) => {
    onLanguagesChange(
      enabled ? [...languages, id] : languages.filter((l) => l !== id)
    );
  };

  const stepsWithSubSteps = STEP_CONFIGS.filter((s) => s.subSteps.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-6">
        <div className="space-y-2">
          <span className="text-sm font-medium">Languages</span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {LANGUAGES.map((lang) => (
              <div key={lang.id} className="flex items-center gap-2">
                <Checkbox
                  id={`global-lang-${lang.id}`}
                  checked={languages.includes(lang.id)}
                  onCheckedChange={(checked) => toggleLanguage(lang.id, !!checked)}
                  disabled={disabled}
                />
                <Label
                  htmlFor={`global-lang-${lang.id}`}
                  className="text-sm font-normal cursor-pointer"
                >
                  {lang.label}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium">Test Case Count</span>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={testcaseCount || ""}
              onChange={(e) => onTestcaseCountChange(parseInt(e.target.value) || 0)}
              className="w-24"
              disabled={disabled}
              placeholder=""
            />
            <span className="text-xs text-muted-foreground">
              Recommended: 30 to 50
            </span>
          </div>
        </div>
      </div>

      {/* Sub-step options per step */}
      {stepsWithSubSteps.map((config) => {
        const enabled = enabledSubSteps.get(config.id) || [];
        return (
          <div key={config.id} className="space-y-2">
            <span className="text-sm font-medium">{config.label}</span>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {config.subSteps.map((sub) => (
                <div key={sub.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`global-sub-${config.id}-${sub.id}`}
                    checked={enabled.includes(sub.id)}
                    onCheckedChange={(checked) => onSubStepToggle(config.id, sub.id, !!checked)}
                    disabled={disabled}
                  />
                  <Label
                    htmlFor={`global-sub-${config.id}-${sub.id}`}
                    className="text-sm font-normal cursor-pointer"
                    title={sub.description}
                  >
                    {sub.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
