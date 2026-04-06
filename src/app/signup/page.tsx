"use client";

import { useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";
import { AuthCard } from "@/components/auth/AuthCard";
import { FormField } from "@/components/auth/FormField";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { LoadingButton } from "@/components/auth/LoadingButton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Mail, RotateCcw } from "lucide-react";
import {
  validateEmail,
  validatePassword,
  validateDisplayName,
  sanitizeErrorMessage,
} from "@/lib/auth-validation";

type Step = "form" | "verify";

export default function SignupPage() {
  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"problem_setter" | "admin">("problem_setter");
  const [adminSecret, setAdminSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [resendCooldown, setResendCooldown] = useState(0);
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();

  const validateField = useCallback(
    (field: string, value: string) => {
      const errors = { ...fieldErrors };
      switch (field) {
        case "displayName": {
          const r = validateDisplayName(value);
          if (!r.valid && touched.displayName) errors.displayName = r.error!;
          else delete errors.displayName;
          break;
        }
        case "email": {
          const r = validateEmail(value);
          if (!r.valid && touched.email) errors.email = r.error!;
          else delete errors.email;
          break;
        }
        case "password": {
          const r = validatePassword(value);
          if (r.score < 2 && touched.password)
            errors.password = "Password is too weak. Meet the requirements below.";
          else delete errors.password;
          break;
        }
        case "adminSecret": {
          if (!value && touched.adminSecret)
            errors.adminSecret = "Admin secret key is required.";
          else delete errors.adminSecret;
          break;
        }
      }
      setFieldErrors(errors);
    },
    [fieldErrors, touched]
  );

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const values: Record<string, string> = {
      displayName,
      email,
      password,
      adminSecret,
    };
    validateField(field, values[field]);
  };

  const logAudit = (eventType: string, userId?: string) => {
    fetch("/api/auth/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: eventType, user_id: userId }),
    }).catch(() => {});
  };

  const startResendCooldown = () => {
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
  };

  const handleResendVerification = async () => {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
    });
    if (error) {
      toast(sanitizeErrorMessage(error.message), "error");
    } else {
      toast("Verification email resent!", "success");
      startResendCooldown();
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields
    const nameResult = validateDisplayName(displayName);
    const emailResult = validateEmail(email);
    const passwordResult = validatePassword(password);
    const allTouched = {
      displayName: true,
      email: true,
      password: true,
      adminSecret: true,
    };
    setTouched(allTouched);

    const errors: Record<string, string> = {};
    if (!nameResult.valid) errors.displayName = nameResult.error!;
    if (!emailResult.valid) errors.email = emailResult.error!;
    if (passwordResult.score < 2)
      errors.password = "Password is too weak. Meet the requirements below.";
    if (role === "admin" && !adminSecret)
      errors.adminSecret = "Admin secret key is required.";

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstError = Object.keys(errors)[0];
      document.getElementById(firstError)?.focus();
      return;
    }

    setFieldErrors({});
    setLoading(true);

    // Validate admin secret server-side
    if (role === "admin") {
      const res = await fetch("/api/auth/verify-admin-secret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: adminSecret }),
      });
      if (!res.ok) {
        const data = await res.json();
        const msg = data.error || "Invalid admin secret key.";
        setFieldErrors({ adminSecret: msg });
        toast(msg, "error");
        setLoading(false);
        return;
      }
    }

    const { error, data } = await supabase.auth.signUp({
      email: emailResult.normalized,
      password,
      options: {
        data: { display_name: nameResult.sanitized, role },
      },
    });

    if (error) {
      const msg = sanitizeErrorMessage(error.message);
      setFieldErrors({ form: msg });
      toast(msg, "error");
      setLoading(false);
      return;
    }

    // Update profile role and set approval status
    if (data.user) {
      const profileUpdates: Record<string, string> = { role };
      // Problem setters need admin approval; admins are auto-approved
      if (role === "problem_setter") {
        profileUpdates.status = "pending_approval";
      }
      await supabase.from("profiles").update(profileUpdates).eq("id", data.user.id);
      logAudit("signup", data.user.id);
    }

    // Check if email confirmation is needed
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      if (role === "problem_setter") {
        toast("Account created! Waiting for admin approval.", "success");
        router.push("/pending-approval");
      } else {
        toast("Account created successfully!", "success");
        router.push("/");
      }
      router.refresh();
    } else {
      setStep("verify");
      startResendCooldown();
      setLoading(false);
    }
  };

  // Email verification step
  if (step === "verify") {
    return (
      <AuthCard
        title="Check your email"
        subtitle={`We sent a verification link to ${email}`}
        footer={
          <Link
            href="/login"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        }
      >
        <div className="flex flex-col items-center gap-6 py-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Mail className="h-8 w-8 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground text-center">
            Click the link in the email to verify your account. If you
            don&apos;t see it, check your spam folder.
          </p>
          <Button
            variant="outline"
            onClick={handleResendVerification}
            disabled={resendCooldown > 0}
            className="w-full"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {resendCooldown > 0
              ? `Resend in ${resendCooldown}s`
              : "Resend verification email"}
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create an account"
      subtitle="Get started with Coding Automation"
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSignup} className="space-y-4">
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
          label="Display Name"
          htmlFor="displayName"
          error={fieldErrors.displayName}
        >
          <Input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              if (touched.displayName)
                validateField("displayName", e.target.value);
            }}
            onBlur={() => handleBlur("displayName")}
            placeholder="Your name"
            maxLength={50}
            autoComplete="name"
            aria-invalid={!!fieldErrors.displayName}
          />
        </FormField>

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
          />
        </FormField>

        <FormField
          label="Password"
          htmlFor="password"
          error={fieldErrors.password}
        >
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (touched.password) validateField("password", e.target.value);
            }}
            onBlur={() => handleBlur("password")}
            placeholder="Create a strong password"
            autoComplete="new-password"
            showStrength
          />
        </FormField>

        {/* Role Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Role</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setRole("problem_setter");
                setAdminSecret("");
                setFieldErrors((prev) => {
                  const next = { ...prev };
                  delete next.adminSecret;
                  return next;
                });
              }}
              className={`flex flex-col items-center gap-1 rounded-md border px-3 py-3 text-sm transition-all duration-200 ${
                role === "problem_setter"
                  ? "border-primary bg-primary/10 text-primary shadow-sm"
                  : "border-input text-muted-foreground hover:border-foreground/30 hover:bg-muted/50"
              }`}
            >
              <span className="font-medium">Problem Setter</span>
              <span className="text-xs opacity-70">Create & manage questions</span>
            </button>
            <button
              type="button"
              onClick={() => setRole("admin")}
              className={`flex flex-col items-center gap-1 rounded-md border px-3 py-3 text-sm transition-all duration-200 ${
                role === "admin"
                  ? "border-primary bg-primary/10 text-primary shadow-sm"
                  : "border-input text-muted-foreground hover:border-foreground/30 hover:bg-muted/50"
              }`}
            >
              <span className="font-medium">Admin</span>
              <span className="text-xs opacity-70">Full access & user mgmt</span>
            </button>
          </div>
        </div>

        {role === "admin" && (
          <FormField
            label="Admin Secret Key"
            htmlFor="adminSecret"
            error={fieldErrors.adminSecret}
            hint="Contact an existing admin to get the secret key."
          >
            <PasswordInput
              id="adminSecret"
              value={adminSecret}
              onChange={(e) => {
                setAdminSecret(e.target.value);
                if (touched.adminSecret)
                  validateField("adminSecret", e.target.value);
              }}
              onBlur={() => handleBlur("adminSecret")}
              placeholder="Enter admin secret key"
            />
          </FormField>
        )}

        <LoadingButton
          type="submit"
          loading={loading}
          loadingText="Creating account..."
        >
          Sign up
        </LoadingButton>
      </form>
    </AuthCard>
  );
}
