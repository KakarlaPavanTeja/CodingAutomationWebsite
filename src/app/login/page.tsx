"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";
import { AuthCard } from "@/components/auth/AuthCard";
import { FormField } from "@/components/auth/FormField";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { LoadingButton } from "@/components/auth/LoadingButton";
import { Input } from "@/components/ui/input";
import { validateEmail } from "@/lib/auth-validation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const router = useRouter();
  const { toast } = useToast();

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
        if (!result.valid && touched.email) errors.email = result.error!;
        else delete errors.email;
      }
      if (field === "password") {
        if (!value && touched.password) errors.password = "Password is required.";
        else delete errors.password;
      }
      setFieldErrors(errors);
    },
    [fieldErrors, touched],
  );

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    validateField(field, field === "email" ? email : password);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

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

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailResult.normalized, password }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = data.error || "Sign in failed.";
      if (data.code === "password_reset_required") {
        toast(msg, "info");
        router.push(`/reset-password?email=${encodeURIComponent(emailResult.normalized)}`);
        return;
      }
      setFieldErrors({ form: msg });
      toast(msg, "error");
      setLoading(false);
      return;
    }

    if (data.status === "pending_approval") {
      toast("Your account is pending admin approval.", "info");
      router.push("/pending-approval");
      router.refresh();
      return;
    }

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
              Need help signing in?
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
