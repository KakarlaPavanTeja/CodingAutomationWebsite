"use client";

import { useState, useEffect, Suspense, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";
import { AuthCard } from "@/components/auth/AuthCard";
import { FormField } from "@/components/auth/FormField";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { LoadingButton } from "@/components/auth/LoadingButton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import {
  validateEmail,
  validatePassword,
  sanitizeErrorMessage,
} from "@/lib/auth-validation";

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
  const [mode, setMode] = useState<"request" | "update">("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [resendCooldown, setResendCooldown] = useState(0);
  const [emailSent, setEmailSent] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { toast } = useToast();

  useEffect(() => {
    if (searchParams.get("mode") === "update") {
      setMode("update");
      return;
    }

    const hash = window.location.hash;
    if (hash.includes("type=recovery") || hash.includes("access_token")) {
      setMode("update");
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setMode("update");
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase, searchParams]);

  const startResendCooldown = useCallback(() => {
    setResendCooldown(60);
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const logAudit = (eventType: string) => {
    fetch("/api/auth/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: eventType }),
    }).catch(() => {});
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});

    const emailResult = validateEmail(email);
    if (!emailResult.valid) {
      setTouched({ email: true });
      setFieldErrors({ email: emailResult.error! });
      document.getElementById("email")?.focus();
      return;
    }

    setLoading(true);

    // Check if user exists
    const checkRes = await fetch("/api/auth/check-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailResult.normalized }),
    });

    if (!checkRes.ok) {
      const data = await checkRes.json();
      const msg = data.error || "No account found with this email.";
      setFieldErrors({ form: msg });
      toast(msg, "error");
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(
      emailResult.normalized,
      { redirectTo: `${window.location.origin}/auth/callback?type=recovery` }
    );

    if (error) {
      const msg = sanitizeErrorMessage(error.message);
      setFieldErrors({ form: msg });
      toast(msg, "error");
    } else {
      toast("Password reset link sent! Check your email.", "success");
      logAudit("password_reset_request");
      setEmailSent(true);
      startResendCooldown();
    }
    setLoading(false);
  };

  const handleResend = async () => {
    const emailResult = validateEmail(email);
    if (!emailResult.valid) return;

    const { error } = await supabase.auth.resetPasswordForEmail(
      emailResult.normalized,
      { redirectTo: `${window.location.origin}/auth/callback?type=recovery` }
    );

    if (error) {
      toast(sanitizeErrorMessage(error.message), "error");
    } else {
      toast("Reset link resent!", "success");
      startResendCooldown();
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ password: true, confirmPassword: true });

    const errors: Record<string, string> = {};
    const passwordResult = validatePassword(password);
    if (passwordResult.score < 2) {
      errors.password = "Password is too weak.";
    }
    if (password !== confirmPassword) {
      errors.confirmPassword = "Passwords do not match.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstError = Object.keys(errors)[0];
      document.getElementById(firstError)?.focus();
      return;
    }

    setFieldErrors({});
    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      const msg = sanitizeErrorMessage(error.message);
      setFieldErrors({ form: msg });
      toast(msg, "error");
      setLoading(false);
      return;
    }

    logAudit("password_reset_complete");
    await supabase.auth.signOut();
    sessionStorage.setItem(
      "toast",
      "Password reset successful! Please sign in with your new password."
    );
    router.push("/login");
  };

  if (mode === "update") {
    return (
      <AuthCard
        title="Set new password"
        subtitle="Enter your new password below"
      >
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

          <FormField
            label="New Password"
            htmlFor="password"
            error={fieldErrors.password}
          >
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

          <LoadingButton
            type="submit"
            loading={loading}
            loadingText="Updating..."
          >
            Update Password
          </LoadingButton>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset password"
      subtitle="Enter your email to receive a reset link"
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
      <form onSubmit={handleRequestReset} className="space-y-4">
        {fieldErrors.form && (
          <div
            role="alert"
            aria-live="polite"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive animate-in fade-in slide-in-from-top-2 duration-300"
          >
            {fieldErrors.form}
          </div>
        )}

        {emailSent && (
          <div className="rounded-md border border-green-500/50 bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-400 animate-in fade-in duration-300">
            Reset link sent to <strong>{email}</strong>. Check your inbox.
          </div>
        )}

        <FormField label="Email" htmlFor="email" error={fieldErrors.email}>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (touched.email) {
                const r = validateEmail(e.target.value);
                setFieldErrors((prev) => {
                  const next = { ...prev };
                  if (!r.valid) next.email = r.error!;
                  else delete next.email;
                  return next;
                });
              }
            }}
            onBlur={() => handleBlur("email")}
            placeholder="you@example.com"
            autoComplete="email"
            aria-invalid={!!fieldErrors.email}
          />
        </FormField>

        {!emailSent ? (
          <LoadingButton
            type="submit"
            loading={loading}
            loadingText="Sending..."
          >
            Send Reset Link
          </LoadingButton>
        ) : (
          <div className="space-y-2">
            <LoadingButton
              type="submit"
              loading={loading}
              loadingText="Sending..."
            >
              Send Reset Link
            </LoadingButton>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleResend}
              disabled={resendCooldown > 0}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {resendCooldown > 0
                ? `Resend in ${resendCooldown}s`
                : "Resend reset link"}
            </Button>
          </div>
        )}
      </form>
    </AuthCard>
  );
}
