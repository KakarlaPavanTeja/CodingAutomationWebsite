"use client";

import { useEffect, useState } from "react";
import { Shield, UserX, UserCheck } from "lucide-react";

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

  if (loading) {
    return <p className="text-muted-foreground">Loading users...</p>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">
        Users ({users.length})
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
            {users.map((u) => (
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
                    {u.status === "active" ? (
                      <button
                        onClick={() => updateUser(u.id, { status: "left" })}
                        disabled={actionLoading === u.id}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                        title="Deactivate user"
                      >
                        <UserX className="h-3 w-3" />
                      </button>
                    ) : (
                      <button
                        onClick={() => updateUser(u.id, { status: "active" })}
                        disabled={actionLoading === u.id}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-green-600 transition-colors hover:bg-green-500/10 disabled:opacity-50"
                        title="Reactivate user"
                      >
                        <UserCheck className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
