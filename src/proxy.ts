import { NextResponse, type NextRequest } from "next/server";
import { getSessionByToken, SESSION_COOKIE } from "@/lib/auth/session";

export async function proxy(request: NextRequest) {
  const isPublicPage =
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname === "/signup" ||
    request.nextUrl.pathname === "/reset-password" ||
    request.nextUrl.pathname === "/guide" ||
    request.nextUrl.pathname === "/" ||
    request.nextUrl.pathname === "/pending-approval" ||
    request.nextUrl.pathname.startsWith("/auth/");

  const isApiRoute = request.nextUrl.pathname.startsWith("/api");

  // API routes handle their own auth.
  if (isApiRoute) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSessionByToken(token);

  if (!session && !isPublicPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (session && !isPublicPage) {
    if (session.profile.status === "pending_approval") {
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
  }

  // Logged-in users skip login/signup pages.
  const isLoginSignup =
    request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup";
  if (session && isLoginSignup) {
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
