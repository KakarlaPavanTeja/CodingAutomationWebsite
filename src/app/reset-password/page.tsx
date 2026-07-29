"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";
import { AuthCard } from "@/components/auth/AuthCard";
import { FormField } from "@/components/auth/FormField";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { LoadingButton } from "@/components/auth/LoadingButton";
import { validatePassword } from "@/lib/auth-validation";

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  // Derived, not synced. The URL is the source of truth; the old effect committed one
  // render in "request" mode with a token already present before correcting itself.
  const token = searchParams.get("token") ?? "";
  const mode: "request" | "update" =
    searchParams.get("mode") === "update" && token ? "update" : "request";

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ password: true, confirmPassword: true });

    const errors: Record<string, string> = {};
    const passwordResult = validatePassword(password);
    if (passwordResult.score < 2) errors.password = "Password is too weak.";
    if (password !== confirmPassword) errors.confirmPassword = "Passwords do not match.";

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstError = Object.keys(errors)[0];
      document.getElementById(firstError)?.focus();
      return;
    }

    setFieldErrors({});
    setLoading(true);

    const res = await fetch("/api/auth/reset-password/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = data.error || "Could not reset password.";
      setFieldErrors({ form: msg });
      toast(msg, "error");
      setLoading(false);
      return;
    }

    sessionStorage.setItem(
      "toast",
      "Password reset successful! Please sign in with your new password.",
    );
    router.push("/login");
  };

  if (mode === "update") {
    return (
      <AuthCard title="Set new password" subtitle="Enter your new password below">
        <form onSubmit={handleUpdatePassword} className="space-y-4">
          {fieldErrors.form && (
            <div
              role="alert"
              aria-live="polite"
              className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive animate-in fade-in slide-in-from-top-2 duration-300"
            >
              {fieldErrors.form}
            </div>
          )}

          <FormField label="New Password" htmlFor="password" error={fieldErrors.password}>
            <PasswordInput
              id="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (touched.password) {
                  const r = validatePassword(e.target.value);
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    if (r.score < 2) next.password = "Password is too weak.";
                    else delete next.password;
                    return next;
                  });
                }
              }}
              onBlur={() => handleBlur("password")}
              placeholder="Create a strong password"
              autoComplete="new-password"
              showStrength
            />
          </FormField>

          <FormField
            label="Confirm Password"
            htmlFor="confirmPassword"
            error={fieldErrors.confirmPassword}
          >
            <PasswordInput
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (touched.confirmPassword) {
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    if (e.target.value !== password)
                      next.confirmPassword = "Passwords do not match.";
                    else delete next.confirmPassword;
                    return next;
                  });
                }
              }}
              onBlur={() => handleBlur("confirmPassword")}
              placeholder="Confirm your password"
              autoComplete="new-password"
            />
          </FormField>

          <LoadingButton type="submit" loading={loading} loadingText="Updating...">
            Update Password
          </LoadingButton>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Need to reset your password?"
      subtitle="Self-serve password reset isn't available right now."
      footer={
        <>
          Remember your password?{" "}
          <Link
            href="/login"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <div className="space-y-4 text-sm text-muted-foreground">
        <p>
          Please contact your administrator to request a password reset link.
          They can generate a single-use link for you from the admin console.
        </p>
        <p>
          Once you receive the link, click it to set a new password.
        </p>
      </div>
    </AuthCard>
  );
}
