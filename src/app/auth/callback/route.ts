import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const type = requestUrl.searchParams.get("type");

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  // Redirect based on the type of auth callback
  if (type === "recovery") {
    return NextResponse.redirect(
      new URL("/reset-password?mode=update", requestUrl.origin)
    );
  }

  // Default: redirect to home after email confirmation
  return NextResponse.redirect(new URL("/", requestUrl.origin));
}
