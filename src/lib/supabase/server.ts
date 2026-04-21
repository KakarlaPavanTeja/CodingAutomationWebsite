import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getProfileRoleById } from "@/lib/db/queries";

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
 * Returns the service client (still needed for Storage operations until Phase 4)
 * + caller profile on success, or an error Response.
 */
export async function requireAdminApi(): Promise<
  | { supabase: Awaited<ReturnType<typeof createServiceClient>>; profile: { id: string; role: string }; error?: never }
  | { error: Response; supabase?: never; profile?: never }
> {
  const anonClient = await createClient();
  const { data: { user } } = await anonClient.auth.getUser();

  if (!user) {
    return { error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }) };
  }

  const profile = await getProfileRoleById(user.id);

  if (!profile || profile.role !== "admin") {
    return { error: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }) };
  }

  const supabase = await createServiceClient();
  return { supabase, profile };
}
