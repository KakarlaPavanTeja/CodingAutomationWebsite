import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/server";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null, profile: null });
  }
  return NextResponse.json({
    user: { id: session.userId, email: session.email },
    profile: {
      id: session.profile.id,
      email: session.profile.email,
      display_name: session.profile.displayName,
      role: session.profile.role,
      status: session.profile.status,
    },
  });
}
