import { cache } from "react";
import { createClient } from "./server";
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

export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
});

export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getUser();
  if (!user) return null;
  const profile = await getProfileById(user.id);
  return profile ? toLegacyProfile(profile) : null;
});

export async function requireAuth() {
  const user = await getUser();
  if (!user) {
    const { unauthorized } = await import("next/navigation");
    unauthorized();
  }
  return user!;
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
