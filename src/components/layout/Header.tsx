"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { LogOut, Settings, User } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

// Nav items are built dynamically based on role
const BASE_NAV = [
  { href: "/", label: "Dashboard" },
];
const ADMIN_NAV_INSERT = { href: "/admin", label: "Admin" };
const PROBLEMS_NAV = { href: "/problems", label: "Problems" };
const WHATS_NEW_NAV = { href: "/whats-new", label: "What's New" };
const GUIDE_NAV = { href: "/guide", label: "Guide" };

export function Header() {
  const pathname = usePathname();
  const { user, profile, loading, signOut } = useAuth();
  const { toast } = useToast();

  const isAuthPage =
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/reset-password";
  const isGuidePage = pathname === "/guide";

  const handleSignOut = () => {
    sessionStorage.setItem("toast", "Signed out successfully!");
    signOut();
  };

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 items-center px-4">
        <Link
          href={user ? "/" : "/guide"}
          className="mr-8 flex items-center gap-2 font-semibold"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          Coding Automation
        </Link>

        {/* Nav for logged-in users (not on auth pages) */}
        {!isAuthPage && !loading && user && (() => {
          // Build nav: Dashboard, [Admin], Problems, Guide
          const navItems = [...BASE_NAV];
          if (profile?.role === "admin") navItems.push(ADMIN_NAV_INSERT);
          navItems.push(PROBLEMS_NAV, WHATS_NEW_NAV, GUIDE_NAV);
          return (
            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-3 py-1.5 text-sm rounded-md transition-colors",
                    (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href))
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          );
        })()}

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />

          {/* Guest on guide page: show Login/Signup */}
          {!loading && !user && isGuidePage && (
            <div className="flex items-center gap-2 ml-2">
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="sm">Sign up</Button>
              </Link>
            </div>
          )}

          {/* Logged-in user: show profile/settings/logout */}
          {!loading && user && !isAuthPage && (
            <div className="flex items-center gap-2 ml-2">
              <Link
                href="/settings"
                className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <User className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {profile?.display_name || user.email}
                </span>
              </Link>
              <Link
                href="/settings"
                className="inline-flex items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground hover:bg-muted"
                title="Settings"
              >
                <Settings className="h-4 w-4" />
              </Link>
              <button
                onClick={handleSignOut}
                className="inline-flex items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground hover:bg-muted"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
