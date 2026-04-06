import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from Server Component — ignore.
            // Middleware will refresh the session.
          }
        },
      },
    }
  );
}

export async function createServiceClient() {
  const { createClient: createSupabaseClient } = await import(
    "@supabase/supabase-js"
  );
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Verify the current caller is an authenticated admin.
 * Use in API routes: const { error } = await requireAdminApi();
 * Returns the service client + caller profile on success, or an error Response.
 */
export async function requireAdminApi(): Promise<
  | { supabase: Awaited<ReturnType<typeof createServiceClient>>; profile: { id: string; role: string }; error?: never }
  | { error: Response; supabase?: never; profile?: never }
> {
  // Use the anon client (reads caller's session cookie)
  const anonClient = await createClient();
  const { data: { user } } = await anonClient.auth.getUser();

  if (!user) {
    return { error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }) };
  }

  const { data: profile } = await anonClient
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return { error: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }) };
  }

  // Return service client for admin operations
  const supabase = await createServiceClient();
  return { supabase, profile };
}
