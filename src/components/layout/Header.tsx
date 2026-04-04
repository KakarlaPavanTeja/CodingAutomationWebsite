"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { LogOut, Settings, User } from "lucide-react";
import { useToast } from "@/components/ui/toast";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/outputs", label: "Outputs" },
  { href: "/guide", label: "Guide" },
];

export function Header() {
  const pathname = usePathname();
  const { user, profile, loading, signOut } = useAuth();
  const { toast } = useToast();

  const isAuthPage = pathname === "/login" || pathname === "/signup" || pathname === "/reset-password";

  const handleSignOut = () => {
    sessionStorage.setItem("toast", "Signed out successfully!");
    signOut();
  };

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 items-center px-4">
        <Link href="/" className="mr-8 flex items-center gap-2 font-semibold">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          Coding Automation
        </Link>
        {!isAuthPage && !loading && user && (
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md transition-colors",
                  pathname === item.href
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {item.label}
              </Link>
            ))}
            {profile?.role === "admin" && (
              <Link
                href="/admin"
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md transition-colors",
                  pathname.startsWith("/admin")
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                Admin
              </Link>
            )}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
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
