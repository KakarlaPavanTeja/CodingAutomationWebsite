import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { requireAuthApi } from "@/lib/auth/server";
import { validateDisplayName } from "@/lib/auth-validation";

export async function PATCH(request: NextRequest) {
  const auth = await requireAuthApi();
  if (auth.error) return auth.error;

  let body: { display_name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (typeof body.display_name !== "string") {
    return NextResponse.json({ error: "display_name is required." }, { status: 400 });
  }

  const result = validateDisplayName(body.display_name);
  if (!result.valid) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await db
    .update(profiles)
    .set({ displayName: result.sanitized, updatedAt: new Date() })
    .where(eq(profiles.id, auth.session.userId));

  return NextResponse.json({ ok: true });
}
