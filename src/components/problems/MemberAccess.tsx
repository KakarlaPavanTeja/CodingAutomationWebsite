"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type Member = {
  id: string;
  email: string;
  display_name: string | null;
};

function memberLabel(m: Member): string {
  return m.display_name?.trim() || m.email;
}

/**
 * Controlled multi-select used in the problem creation flow to pick members
 * who should be able to work on the new problem.
 */
export function MemberPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/members", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((data) => {
        if (!cancelled) setMembers((data.members as Member[]) || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedMembers = members.filter((m) => selectedSet.has(m.id));
  const filtered = members.filter((m) =>
    memberLabel(m).toLowerCase().includes(query.toLowerCase()) ||
    m.email.toLowerCase().includes(query.toLowerCase()),
  );

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div ref={containerRef} className="relative space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
      >
        <Users className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">
          {selected.length > 0
            ? `${selected.length} member${selected.length === 1 ? "" : "s"} selected`
            : "Select members…"}
        </span>
        <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" />
      </button>

      {selectedMembers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedMembers.map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium"
            >
              {memberLabel(m)}
              <button
                type="button"
                onClick={() => toggle(m.id)}
                className="hover:text-primary/70"
                aria-label={`Remove ${memberLabel(m)}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg">
          <div className="p-2 border-b">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search members…"
              className="flex w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              autoFocus
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {members.length === 0 ? "No other members found." : "No matches."}
              </p>
            ) : (
              filtered.map((m) => {
                const isSelected = selectedSet.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggle(m.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                      isSelected && "bg-muted/50",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border",
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-input",
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex flex-col">
                      <span className="font-medium leading-tight">{memberLabel(m)}</span>
                      {m.display_name && (
                        <span className="text-xs text-muted-foreground leading-tight">
                          {m.email}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type AccessMember = Member & {
  granted_by: string | null;
  created_at: string;
};

/**
 * "Manage access" dialog for an existing problem. Owner or admin only.
 */
export function ManageAccessDialog({
  problemId,
  open,
  onClose,
}: {
  problemId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState<AccessMember[]>([]);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch(`/api/problems/${problemId}/access`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : { members: [] },
      ),
      fetch("/api/members", { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : { members: [] },
      ),
    ])
      .then(([accessData, membersData]) => {
        setCurrent((accessData.members as AccessMember[]) || []);
        setAllMembers((membersData.members as Member[]) || []);
      })
      .catch(() => setError("Failed to load access list."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) {
      setToAdd([]);
      setError(null);
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, problemId]);

  if (!open) return null;

  const currentIds = new Set(current.map((m) => m.id));
  const available = allMembers.filter((m) => !currentIds.has(m.id));

  const handleAdd = async () => {
    if (toAdd.length === 0) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/problems/${problemId}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberIds: toAdd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add members");
      setToAdd([]);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add members");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (memberId: string) => {
    setBusyId(memberId);
    setError(null);
    try {
      const res = await fetch(`/api/problems/${problemId}/access`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove member");
      setCurrent((prev) => prev.filter((m) => m.id !== memberId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove member");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border rounded-lg p-6 w-full max-w-lg space-y-4 shadow-lg mx-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Manage access</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Members with access can open this problem and work on it just like you —
          edit files, run pipeline steps, view logs, and download outputs.
        </p>

        {/* Add members */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Add members</label>
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <MemberPickerStatic
                members={available}
                selected={toAdd}
                onChange={setToAdd}
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={adding || toAdd.length === 0}
              className="px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              {adding ? "Adding…" : "Add"}
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Current access list */}
        <div className="space-y-2">
          <label className="text-sm font-medium">
            Shared with ({current.length})
          </label>
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : current.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              Not shared with anyone yet.
            </p>
          ) : (
            <ul className="rounded-md border divide-y max-h-56 overflow-y-auto">
              {current.map((m) => (
                <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="flex flex-col">
                    <span className="font-medium leading-tight">
                      {m.display_name?.trim() || m.email}
                    </span>
                    {m.display_name && (
                      <span className="text-xs text-muted-foreground leading-tight">
                        {m.email}
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => handleRemove(m.id)}
                    disabled={busyId === m.id}
                    className="ml-auto text-xs text-red-500 hover:text-red-700 font-medium transition-colors disabled:opacity-50"
                  >
                    {busyId === m.id ? "Removing…" : "Remove"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-sm font-medium border hover:bg-muted transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Like MemberPicker but operates on a provided member list (no fetch),
 * used inside the manage-access dialog where the list is already loaded.
 */
function MemberPickerStatic({
  members,
  selected,
  onChange,
}: {
  members: Member[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const filtered = members.filter((m) =>
    memberLabel(m).toLowerCase().includes(query.toLowerCase()) ||
    m.email.toLowerCase().includes(query.toLowerCase()),
  );

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
      >
        <span className="text-muted-foreground">
          {selected.length > 0 ? `${selected.length} selected` : "Select members…"}
        </span>
        <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg">
          <div className="p-2 border-b">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search members…"
              className="flex w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {members.length === 0 ? "No members available." : "No matches."}
              </p>
            ) : (
              filtered.map((m) => {
                const isSelected = selectedSet.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggle(m.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                      isSelected && "bg-muted/50",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border",
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-input",
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex flex-col">
                      <span className="font-medium leading-tight">{memberLabel(m)}</span>
                      {m.display_name && (
                        <span className="text-xs text-muted-foreground leading-tight">
                          {m.email}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
