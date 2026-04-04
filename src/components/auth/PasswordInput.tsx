"use client";

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff } from "lucide-react";
import { validatePassword } from "@/lib/auth-validation";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  showStrength?: boolean;
  error?: string;
};

const STRENGTH_COLORS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-yellow-500",
  "bg-green-500",
];

export function PasswordInput({
  showStrength,
  error,
  className,
  id,
  value,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  const strength = useMemo(() => {
    if (!showStrength || typeof value !== "string") return null;
    return validatePassword(value);
  }, [showStrength, value]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          type={visible ? "text" : "password"}
          id={id}
          value={value}
          className={cn("pr-10", error && "border-destructive", className)}
          aria-invalid={!!error}
          aria-describedby={
            [
              error ? `${id}-error` : null,
              showStrength ? `${id}-strength` : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-0 top-0 h-10 w-10 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          aria-label={visible ? "Hide password" : "Show password"}
          tabIndex={-1}
        >
          {visible ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      </div>

      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-sm text-destructive animate-in fade-in slide-in-from-top-1 duration-200"
        >
          {error}
        </p>
      )}

      {showStrength && typeof value === "string" && value.length > 0 && strength && (
        <div id={`${id}-strength`} className="space-y-1.5">
          {/* Strength bar */}
          <div className="flex gap-1">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-all duration-300",
                  i < strength.score
                    ? STRENGTH_COLORS[strength.score - 1]
                    : "bg-muted"
                )}
              />
            ))}
          </div>
          {/* Label + requirements */}
          <div className="flex items-center justify-between">
            <span
              className={cn(
                "text-xs font-medium",
                strength.score <= 1 && "text-red-500",
                strength.score === 2 && "text-orange-500",
                strength.score === 3 && "text-yellow-500",
                strength.score === 4 && "text-green-500"
              )}
            >
              {strength.label}
            </span>
          </div>
          {strength.errors.length > 0 && (
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {strength.errors.map((err) => (
                <li key={err} className="flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
                  {err}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
