"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";
import { AuthCard } from "@/components/auth/AuthCard";
import { FormField } from "@/components/auth/FormField";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { LoadingButton } from "@/components/auth/LoadingButton";
import { Input } from "@/components/ui/input";
import { validateEmail, sanitizeErrorMessage } from "@/lib/auth-validation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();

  // Show toast from redirect (sign out, session expired)
  useEffect(() => {
    const msg = sessionStorage.getItem("toast");
    if (msg) {
      sessionStorage.removeItem("toast");
      toast(msg, "success");
    }
    const expired = sessionStorage.getItem("session_expired");
    if (expired) {
      sessionStorage.removeItem("session_expired");
      toast("Your session expired. Please sign in again.", "info");
    }
  }, [toast]);

  const validateField = useCallback(
    (field: string, value: string) => {
      const errors = { ...fieldErrors };
      if (field === "email") {
        const result = validateEmail(value);
        if (!result.valid && touched.email) {
          errors.email = result.error!;
        } else {
          delete errors.email;
        }
      }
      if (field === "password") {
        if (!value && touched.password) {
          errors.password = "Password is required.";
        } else {
          delete errors.password;
        }
      }
      setFieldErrors(errors);
    },
    [fieldErrors, touched]
  );

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    validateField(field, field === "email" ? email : password);
  };

  const logAudit = (eventType: string, userId?: string, metadata?: Record<string, unknown>) => {
    fetch("/api/auth/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: eventType, user_id: userId, metadata }),
    }).catch(() => {});
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields
    const emailResult = validateEmail(email);
    if (!emailResult.valid) {
      setTouched({ email: true, password: true });
      setFieldErrors({ email: emailResult.error! });
      document.getElementById("email")?.focus();
      return;
    }
    if (!password) {
      setTouched({ email: true, password: true });
      setFieldErrors({ password: "Password is required." });
      document.getElementById("password")?.focus();
      return;
    }

    setFieldErrors({});
    setLoading(true);

    const { error, data } = await supabase.auth.signInWithPassword({
      email: emailResult.normalized,
      password,
    });

    if (error) {
      const msg = sanitizeErrorMessage(error.message);
      setFieldErrors({ form: msg });
      toast(msg, "error");
      logAudit("login_failure", undefined, { email: emailResult.normalized });
      setLoading(false);
      return;
    }

    logAudit("login_success", data.user?.id);
    toast("Signed in successfully!", "success");
    router.push("/");
    router.refresh();
  };

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to your account"
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={handleLogin} className="space-y-4">
        {fieldErrors.form && (
          <div
            role="alert"
            aria-live="polite"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive animate-in fade-in slide-in-from-top-2 duration-300"
          >
            {fieldErrors.form}
          </div>
        )}

        <FormField label="Email" htmlFor="email" error={fieldErrors.email}>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (touched.email) validateField("email", e.target.value);
            }}
            onBlur={() => handleBlur("email")}
            placeholder="you@example.com"
            autoComplete="email"
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
          />
        </FormField>

        <FormField
          label="Password"
          htmlFor="password"
          error={fieldErrors.password}
          rightLabel={
            <Link
              href="/reset-password"
              className="text-xs text-muted-foreground hover:text-primary underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          }
        >
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (touched.password) validateField("password", e.target.value);
            }}
            onBlur={() => handleBlur("password")}
            placeholder="Enter your password"
            autoComplete="current-password"
            error={undefined}
          />
        </FormField>

        <LoadingButton
          type="submit"
          loading={loading}
          loadingText="Signing in..."
        >
          Sign in
        </LoadingButton>
      </form>
    </AuthCard>
  );
}
