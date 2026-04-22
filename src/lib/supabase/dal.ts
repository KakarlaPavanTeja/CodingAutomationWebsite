// Backwards-compatibility shim. New code should import from "@/lib/auth/server".
import { cache } from "react";
import { getSession } from "@/lib/auth/server";
import { getProfileById } from "@/lib/db/queries";
import type { Profile as DbProfile } from "@/lib/db/schema";

export type Profile = {
  id: string;
  email: string;
  display_name: string | null;
  role: "admin" | "problem_setter";
  status: "active" | "left" | "pending_approval" | "deactivated";
  created_at: string;
  updated_at: string;
};

function toLegacyProfile(p: DbProfile): Profile {
  return {
    id: p.id,
    email: p.email,
    display_name: p.displayName,
    role: p.role as Profile["role"],
    status: p.status as Profile["status"],
    created_at: (p.createdAt ?? new Date()).toISOString(),
    updated_at: (p.updatedAt ?? new Date()).toISOString(),
  };
}

export const getUser = cache(async () => {
  const s = await getSession();
  if (!s) return null;
  return { id: s.userId, email: s.email };
});

export const getProfile = cache(async (): Promise<Profile | null> => {
  const u = await getUser();
  if (!u) return null;
  const profile = await getProfileById(u.id);
  return profile ? toLegacyProfile(profile) : null;
});

export async function requireAuth() {
  const u = await getUser();
  if (!u) {
    const { unauthorized } = await import("next/navigation");
    unauthorized();
  }
  return u!;
}

export async function requireAdmin() {
  const profile = await getProfile();
  if (!profile) {
    const { unauthorized } = await import("next/navigation");
    unauthorized();
  }
  if (profile!.role !== "admin") {
    const { forbidden } = await import("next/navigation");
    forbidden();
  }
  return profile!;
}
