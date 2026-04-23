import { NextResponse, type NextRequest } from "next/server";
import { getSessionByToken, SESSION_COOKIE } from "@/lib/auth/session";

// Pages that never require a valid session.
const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/signup",
  "/reset-password",
  "/guide",
  "/pending-approval",
]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Let API routes handle their own auth (they return 401/403 directly).
  if (pathname.startsWith("/api")) return NextResponse.next();

  // Let Next.js internals through.
  if (pathname.startsWith("/auth/")) return NextResponse.next();

  const isPublicPage = PUBLIC_PATHS.has(pathname);
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  // ── Fast path: no token ──────────────────────────────────────────────────
  // Skip the DB entirely — there is definitely no valid session.
  if (!token) {
    if (isPublicPage) return NextResponse.next();
    // Protected page with no token → landing page.
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // ── Token present: validate against DB ───────────────────────────────────
  // Only reached when the browser sent a session_token cookie.
  const session = await getSessionByToken(token);

  if (!session) {
    // Token is invalid or expired.
    if (isPublicPage) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = "/";
    const res = NextResponse.redirect(url);
    // Clear the stale cookie so we don't keep hitting the DB.
    res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  // Valid session — enforce account status.
  if (session.profile.status === "pending_approval") {
    if (pathname === "/pending-approval") return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = "/pending-approval";
    return NextResponse.redirect(url);
  }

  if (session.profile.status === "deactivated") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const res = NextResponse.redirect(url);
    res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  // Authenticated users don't need to see login/signup pages.
  if (pathname === "/login" || pathname === "/signup") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
