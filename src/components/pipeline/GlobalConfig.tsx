"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LANGUAGES } from "@/lib/pipeline-config";
import { Loader2, Save } from "lucide-react";

interface GlobalConfigProps {
  languages: string[];
  onLanguagesChange: (langs: string[]) => void;
  testcaseCount: number;
  onTestcaseCountChange: (count: number) => void;
  ownerTitle: string;
  onOwnerTitleChange: (title: string) => void;
  generateTitleWithAi: boolean;
  onGenerateTitleWithAiChange: (enabled: boolean) => void;
  defaultTagNames: string;
  onDefaultTagNamesChange: (tags: string) => void;
  onSaveTitle: () => Promise<void>;
  disabled?: boolean;
  compact?: boolean;
}

export function GlobalConfig({
  languages,
  onLanguagesChange,
  testcaseCount,
  onTestcaseCountChange,
  ownerTitle,
  onOwnerTitleChange,
  generateTitleWithAi,
  onGenerateTitleWithAiChange,
  defaultTagNames,
  onDefaultTagNamesChange,
  onSaveTitle,
  disabled,
  compact,
}: GlobalConfigProps) {
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const toggleLanguage = (id: string, enabled: boolean) => {
    onLanguagesChange(enabled ? [...languages, id] : languages.filter((l) => l !== id));
  };

  const handleSaveTitle = async () => {
    setSaving(true);
    try {
      await onSaveTitle();
    } finally {
      setSaving(false);
    }
  };

  const labelCls = compact ? "text-[11px] text-muted-foreground" : "text-sm font-medium";
  const itemLabelCls = compact ? "text-[11px] font-normal" : "text-sm font-normal";

  return (
    <div className={compact ? "space-y-2.5" : "space-y-4"}>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <span className={labelCls}>Languages</span>
          <p className="text-[10px] text-muted-foreground mt-0.5 mb-1">
            Applies to the entire pipeline (translate, split, execute, JSON)
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {LANGUAGES.map((lang) => (
              <div key={lang.id} className="flex items-center gap-1.5">
                <Checkbox
                  id={`global-lang-${lang.id}`}
                  checked={languages.includes(lang.id)}
                  onCheckedChange={(checked) => toggleLanguage(lang.id, !!checked)}
                  disabled={disabled}
                  className={compact ? "h-3.5 w-3.5" : undefined}
                />
                <Label htmlFor={`global-lang-${lang.id}`} className={`${itemLabelCls} cursor-pointer`}>
                  {lang.label}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <div>
          <span className={labelCls}>Test cases</span>
          <div className="flex items-center gap-2 mt-1">
            <Input
              type="number"
              value={testcaseCount || ""}
              onChange={(e) => onTestcaseCountChange(parseInt(e.target.value) || 0)}
              className={compact ? "w-16 h-7 text-xs" : "w-24"}
              disabled={disabled}
            />
            {!compact && (
              <span className="text-xs text-muted-foreground">Leave blank to auto-scale by difficulty (min 25)</span>
            )}
          </div>
        </div>
      </div>

      <div>
        <span className={labelCls}>Title (short text)</span>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <Input
            value={ownerTitle}
            onChange={(e) => onOwnerTitleChange(e.target.value)}
            placeholder="Problem title for platform JSON"
            className={compact ? "h-7 text-xs flex-1 min-w-[180px]" : "flex-1 min-w-[220px]"}
            disabled={disabled}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className={compact ? "h-7 text-xs px-2" : undefined}
            onClick={handleSaveTitle}
            disabled={disabled || saving || !ownerTitle.trim()}
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                <Save className="w-3.5 h-3.5 mr-1" />
                Save
              </>
            )}
          </Button>
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          <Checkbox
            id="global-generate-title-ai"
            checked={generateTitleWithAi}
            onCheckedChange={(checked) => onGenerateTitleWithAiChange(!!checked)}
            disabled={disabled}
            className={compact ? "h-3.5 w-3.5" : undefined}
          />
          <Label htmlFor="global-generate-title-ai" className={`${itemLabelCls} cursor-pointer`}>
            Generate title with AI (AI&apos;s choice)
          </Label>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Save writes the title to outputs. Enable AI to run the Titles step on the next GQ run.
        </p>
      </div>

      <div>
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "Hide advanced options" : "Show advanced options"}
        </button>
        {showAdvanced && (
          <div className="mt-2">
            <Label htmlFor="global-default-tags" className={labelCls}>
              Default tag names (one per line)
            </Label>
            <Textarea
              id="global-default-tags"
              value={defaultTagNames}
              onChange={(e) => onDefaultTagNamesChange(e.target.value)}
              placeholder="arrays&#10;two-pointers"
              className={compact ? "mt-1 text-xs min-h-[60px]" : "mt-1 min-h-[80px]"}
              disabled={disabled}
            />
          </div>
        )}
      </div>
    </div>
  );
}
