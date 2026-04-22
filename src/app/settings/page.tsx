"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/auth/LoadingButton";
import { Button } from "@/components/ui/button";
import { User, Mail, Shield, LogOut, Save, KeyRound } from "lucide-react";
import { validateDisplayName, validatePassword } from "@/lib/auth-validation";

export default function SettingsPage() {
  const { user, profile, signOut, refresh } = useAuth();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (profile?.display_name) {
      setDisplayName(profile.display_name);
    }
  }, [profile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameError(null);

    const result = validateDisplayName(displayName);
    if (!result.valid) {
      setNameError(result.error!);
      return;
    }

    setSaving(true);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: result.sanitized }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast(data.error || "Could not update profile.", "error");
    } else {
      toast("Profile updated successfully!", "success");
      await refresh();
    }
    setSaving(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!currentPassword) errs.currentPassword = "Current password is required.";
    const strength = validatePassword(newPassword);
    if (strength.errors.length > 0) {
      errs.newPassword = strength.errors.join(", ");
    }
    if (newPassword !== confirmPassword) {
      errs.confirmPassword = "Passwords do not match.";
    }
    if (currentPassword && newPassword && currentPassword === newPassword) {
      errs.newPassword = "New password must be different from current password.";
    }
    setPwErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setChangingPassword(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || "Could not change password.", "error");
      if (res.status === 401) setPwErrors({ currentPassword: data.error });
    } else {
      toast("Password updated successfully.", "success");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwErrors({});
    }
    setChangingPassword(false);
  };

  const handleLogout = async () => {
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
      <div className="rounded-lg border bg-card p-6 space-y-5">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          Change Password
        </h2>

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current Password</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                setPwErrors((p) => ({ ...p, currentPassword: "" }));
              }}
              aria-invalid={!!pwErrors.currentPassword}
            />
            {pwErrors.currentPassword && (
              <p role="alert" className="text-sm text-destructive">
                {pwErrors.currentPassword}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword">New Password</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setPwErrors((p) => ({ ...p, newPassword: "" }));
              }}
              aria-invalid={!!pwErrors.newPassword}
            />
            <p className="text-xs text-muted-foreground">
              At least 8 characters with upper- and lower-case letters, a number, and a special character.
            </p>
            {pwErrors.newPassword && (
              <p role="alert" className="text-sm text-destructive">
                {pwErrors.newPassword}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm New Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setPwErrors((p) => ({ ...p, confirmPassword: "" }));
              }}
              aria-invalid={!!pwErrors.confirmPassword}
            />
            {pwErrors.confirmPassword && (
              <p role="alert" className="text-sm text-destructive">
                {pwErrors.confirmPassword}
              </p>
            )}
          </div>

          <LoadingButton
            type="submit"
            loading={changingPassword}
            loadingText="Updating..."
            className="w-auto"
          >
            <KeyRound className="mr-2 h-4 w-4" />
            Update Password
          </LoadingButton>
        </form>
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
            <Button variant="outline" onClick={() => setShowLogoutConfirm(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
