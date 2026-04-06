import { cache } from "react";
import { createClient } from "./server";

export type Profile = {
  id: string;
  email: string;
  display_name: string | null;
  role: "admin" | "problem_setter";
  status: "active" | "left" | "pending_approval" | "deactivated";
  created_at: string;
  updated_at: string;
};

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

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return data as Profile | null;
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
