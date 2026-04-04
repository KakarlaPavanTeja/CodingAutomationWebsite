"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/auth/LoadingButton";
import { Button } from "@/components/ui/button";
import { User, Mail, Shield, LogOut, Save, KeyRound } from "lucide-react";
import { validateDisplayName, sanitizeErrorMessage } from "@/lib/auth-validation";

export default function SettingsPage() {
  const { user, profile, signOut } = useAuth();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if (profile?.display_name) {
      setDisplayName(profile.display_name);
    }
  }, [profile]);

  const logAudit = (eventType: string) => {
    fetch("/api/auth/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: eventType, user_id: user?.id }),
    }).catch(() => {});
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameError(null);

    const result = validateDisplayName(displayName);
    if (!result.valid) {
      setNameError(result.error!);
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: result.sanitized,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user!.id);

    if (error) {
      toast(sanitizeErrorMessage(error.message), "error");
    } else {
      toast("Profile updated successfully!", "success");
      logAudit("profile_update");
    }
    setSaving(false);
  };

  const handlePasswordReset = async () => {
    if (!user?.email) return;
    setResettingPassword(true);

    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
    });

    if (error) {
      toast(sanitizeErrorMessage(error.message), "error");
    } else {
      toast("Password reset email sent. Check your inbox.", "success");
    }
    setResettingPassword(false);
  };

  const handleLogout = async () => {
    logAudit("logout");
    sessionStorage.setItem("toast", "Signed out successfully!");
    await signOut();
  };

  if (!user) return null;

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your profile and account preferences
        </p>
      </div>

      {/* Profile Section */}
      <div className="rounded-lg border bg-card p-6 space-y-5">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <User className="h-5 w-5" />
          Profile
        </h2>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setNameError(null);
              }}
              maxLength={50}
              aria-invalid={!!nameError}
            />
            {nameError && (
              <p role="alert" className="text-sm text-destructive">
                {nameError}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email
            </Label>
            <Input
              type="email"
              value={user.email || ""}
              disabled
              aria-label="Email address (read-only)"
            />
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Role
            </Label>
            <Input
              value={profile?.role?.replace("_", " ") || "—"}
              disabled
              className="capitalize"
              aria-label="User role (read-only)"
            />
          </div>

          <LoadingButton
            type="submit"
            loading={saving}
            loadingText="Saving..."
            className="w-auto"
          >
            <Save className="mr-2 h-4 w-4" />
            Save Changes
          </LoadingButton>
        </form>
      </div>

      {/* Security Section */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          Security
        </h2>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Password</p>
            <p className="text-sm text-muted-foreground">
              Send a password reset link to your email
            </p>
          </div>
          <LoadingButton
            variant="outline"
            loading={resettingPassword}
            loadingText="Sending..."
            className="w-auto"
            onClick={handlePasswordReset}
            type="button"
          >
            Reset Password
          </LoadingButton>
        </div>
      </div>

      {/* Sign Out Section */}
      <div className="rounded-lg border border-destructive/30 bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2 text-destructive">
          <LogOut className="h-5 w-5" />
          Sign Out
        </h2>
        <p className="text-sm text-muted-foreground">
          Sign out of your account on this device.
        </p>

        {!showLogoutConfirm ? (
          <Button
            variant="outline"
            onClick={() => setShowLogoutConfirm(true)}
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        ) : (
          <div className="flex items-center gap-3 animate-in fade-in duration-200">
            <Button variant="destructive" onClick={handleLogout}>
              Confirm Sign Out
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowLogoutConfirm(false)}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
