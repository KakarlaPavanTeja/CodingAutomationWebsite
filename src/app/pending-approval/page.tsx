"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Clock } from "lucide-react";

export default function PendingApprovalPage() {
  const { user, profile, loading, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    // If not logged in, go to login
    if (!user) {
      router.push("/login");
      return;
    }
    // If already approved, go home
    if (profile && profile.status === "active") {
      router.push("/");
    }
  }, [user, profile, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-yellow-500/10">
            <Clock className="h-8 w-8 text-yellow-600" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Account Pending Approval</h1>
          <p className="text-muted-foreground">
            Your account has been created successfully. An admin needs to approve
            your account before you can access the platform.
          </p>
          <p className="text-sm text-muted-foreground">
            You will be able to log in once an admin approves your request.
          </p>
        </div>
        <button
          onClick={signOut}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
