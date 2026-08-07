"use client";

import { useEffect, useState } from "react";
import { Shield, UserX, UserCheck, AlertTriangle, Clock, KeyRound, Copy } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";

type UserProfile = {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<UserProfile | null>(null);
  const [resetLink, setResetLink] = useState<{ email: string; url: string } | null>(null);
  const [resetCopied, setResetCopied] = useState(false);

  const generateResetLink = async (u: UserProfile) => {
    setActionLoading(u.id);
    try {
      const r = await fetch(`/api/admin/users/${u.id}/reset-link`, { method: "POST" });
      const data = await r.json();
      if (r.ok && data.url) {
        setResetLink({ email: data.email ?? u.email, url: data.url });
        setResetCopied(false);
      } else {
        alert(data.error || "Failed to generate reset link.");
      }
    } finally {
      setActionLoading(null);
    }
  };

  const fetchUsers = () => {
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((data) => {
        setUsers(data.users || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(fetchUsers, []);

  const updateUser = async (
    userId: string,
    updates: { status?: string; role?: string }
  ) => {
    setActionLoading(userId);
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, ...updates }),
    });
    fetchUsers();
    setActionLoading(null);
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    setActionLoading(deactivateTarget.id);
    await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: deactivateTarget.id }),
    });
    setDeactivateTarget(null);
    fetchUsers();
    setActionLoading(null);
  };

  const approveUser = async (userId: string) => {
    setActionLoading(userId);
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, status: "active" }),
    });
    fetchUsers();
    setActionLoading(null);
  };

  if (loading) {
    return <p className="text-muted-foreground">Loading users...</p>;
  }

  // Separate pending approvals from other users
  const pendingUsers = users.filter((u) => u.status === "pending_approval");
  const otherUsers = users.filter((u) => u.status !== "pending_approval");

  return (
    <div className="space-y-6">
      {/* Pending Approvals */}
      {pendingUsers.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-yellow-500" />
            Pending Approvals ({pendingUsers.length})
          </h2>
          <div className="rounded-lg border border-yellow-500/30 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-yellow-500/5">
                  <th className="text-left px-4 py-3 font-medium">User</th>
                  <th className="text-left px-4 py-3 font-medium">Role</th>
                  <th className="text-left px-4 py-3 font-medium">Signed Up</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingUsers.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium">{u.display_name || "—"}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-blue-500/10 text-blue-700 dark:text-blue-400">
                        {u.role.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => approveUser(u.id)}
                          disabled={actionLoading === u.id}
                          className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          <UserCheck className="h-3 w-3" />
                          Approve
                        </button>
                        <button
                          onClick={() => setDeactivateTarget(u)}
                          disabled={actionLoading === u.id}
                          className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                        >
                          <UserX className="h-3 w-3" />
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All Users */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">
          Users ({otherUsers.length})
        </h2>

        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium">Role</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Joined</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {otherUsers.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">
                        {u.display_name || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.role === "admin"
                          ? "bg-purple-500/10 text-purple-700 dark:text-purple-400"
                          : "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                      }`}
                    >
                      {u.role === "admin" && <Shield className="h-3 w-3" />}
                      {u.role.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.status === "active"
                          ? "bg-green-500/10 text-green-700 dark:text-green-400"
                          : u.status === "deactivated"
                          ? "bg-gray-500/10 text-gray-700 dark:text-gray-400 line-through"
                          : "bg-red-500/10 text-red-700 dark:text-red-400"
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {u.status === "deactivated" ? (
                      <span className="text-xs text-muted-foreground">Removed</span>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        {u.role !== "admin" && (
                          <button
                            onClick={() => updateUser(u.id, { role: "admin" })}
                            disabled={actionLoading === u.id}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground hover:bg-muted disabled:opacity-50"
                            title="Make admin"
                          >
                            <Shield className="h-3 w-3" />
                          </button>
                        )}
                        {u.role === "admin" && (
                          <button
                            onClick={() =>
                              updateUser(u.id, { role: "problem_setter" })
                            }
                            disabled={actionLoading === u.id}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground hover:bg-muted disabled:opacity-50"
                            title="Remove admin"
                          >
                            <Shield className="h-3 w-3 line-through" />
                          </button>
                        )}
                        <button
                          onClick={() => generateResetLink(u)}
                          disabled={actionLoading === u.id}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground hover:bg-muted disabled:opacity-50"
                          title="Generate password reset link"
                        >
                          <KeyRound className="h-3 w-3" />
                        </button>
                        {u.status === "active" ? (
                          <button
                            onClick={() => setDeactivateTarget(u)}
                            disabled={actionLoading === u.id}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                            title="Deactivate user"
                          >
                            <UserX className="h-3 w-3" />
                          </button>
                        ) : u.status === "left" ? (
                          <button
                            onClick={() => updateUser(u.id, { status: "active" })}
                            disabled={actionLoading === u.id}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-green-600 transition-colors hover:bg-green-500/10 disabled:opacity-50"
                            title="Reactivate user"
                          >
                            <UserCheck className="h-3 w-3" />
                          </button>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reset Link Dialog */}
      {resetLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border rounded-lg p-6 w-full max-w-lg space-y-4 shadow-lg mx-4">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Password reset link</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Send this single-use link to <span className="font-medium text-foreground">{resetLink.email}</span>. It expires in 1 hour and can only be used once.
            </p>
            <div className="flex items-stretch gap-2">
              <input
                readOnly
                value={resetLink.url}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 rounded-md border bg-muted/50 px-3 py-2 text-xs font-mono"
              />
              <button
                onClick={async () => {
                  if (!(await copyToClipboard(resetLink.url))) return;
                  setResetCopied(true);
                  setTimeout(() => setResetCopied(false), 2000);
                }}
                className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-xs font-medium border hover:bg-muted transition-colors"
              >
                <Copy className="h-3 w-3" />
                {resetCopied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setResetLink(null)}
                className="px-3 py-1.5 rounded-md text-sm font-medium border hover:bg-muted transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate Confirmation Dialog */}
      {deactivateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border rounded-lg p-6 w-full max-w-md space-y-4 shadow-lg mx-4">
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="font-semibold">Deactivate User</h3>
            </div>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                You are about to deactivate{" "}
                <span className="font-medium text-foreground">
                  {deactivateTarget.display_name || deactivateTarget.email}
                </span>.
              </p>
              <p>This will:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Remove their email and personal information</li>
                <li>Delete their login credentials (they cannot sign in again)</li>
                <li>Keep all problems they created (problems remain intact)</li>
              </ul>
              <p className="font-medium text-destructive">This action cannot be undone.</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeactivateTarget(null)}
                className="px-3 py-1.5 rounded-md text-sm font-medium border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeactivate}
                disabled={actionLoading === deactivateTarget.id}
                className="px-3 py-1.5 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {actionLoading === deactivateTarget.id ? "Deactivating..." : "Deactivate User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
