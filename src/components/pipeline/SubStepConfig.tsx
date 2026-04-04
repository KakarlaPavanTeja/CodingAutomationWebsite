"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { SubStep } from "@/types/pipeline";
import { LANGUAGES } from "@/lib/pipeline-config";

interface SubStepConfigProps {
  subSteps: SubStep[];
  enabledSubSteps: string[];
  onSubStepToggle: (id: string, enabled: boolean) => void;
  hasLanguageSelector: boolean;
  enabledLanguages: string[];
  onLanguageToggle: (id: string, enabled: boolean) => void;
  hasTestcaseCount: boolean;
  testcaseCount: number;
  onTestcaseCountChange: (count: number) => void;
  disabled?: boolean;
}

export function SubStepConfig({
  subSteps,
  enabledSubSteps,
  onSubStepToggle,
  hasLanguageSelector,
  enabledLanguages,
  onLanguageToggle,
  hasTestcaseCount,
  testcaseCount,
  onTestcaseCountChange,
  disabled,
}: SubStepConfigProps) {
  return (
    <div className="space-y-3 pt-2">
      {subSteps.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Sub-operations
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {subSteps.map((sub) => (
              <div key={sub.id} className="flex items-center gap-2">
                <Checkbox
                  id={`sub-${sub.id}`}
                  checked={enabledSubSteps.includes(sub.id)}
                  onCheckedChange={(checked) => onSubStepToggle(sub.id, !!checked)}
                  disabled={disabled}
                />
                <Label
                  htmlFor={`sub-${sub.id}`}
                  className="text-sm font-normal cursor-pointer"
                  title={sub.description}
                >
                  {sub.label}
                </Label>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasLanguageSelector && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Languages
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {LANGUAGES.map((lang) => (
              <div key={lang.id} className="flex items-center gap-2">
                <Checkbox
                  id={`lang-${lang.id}`}
                  checked={enabledLanguages.includes(lang.id)}
                  onCheckedChange={(checked) => onLanguageToggle(lang.id, !!checked)}
                  disabled={disabled}
                />
                <Label
                  htmlFor={`lang-${lang.id}`}
                  className="text-sm font-normal cursor-pointer"
                >
                  {lang.label}
                </Label>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasTestcaseCount && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Test Case Count
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={5}
              max={100}
              value={testcaseCount}
              onChange={(e) => onTestcaseCountChange(parseInt(e.target.value) || 45)}
              className="w-24"
              disabled={disabled}
            />
            <span className="text-sm text-muted-foreground">
              (default: random 45-50)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
