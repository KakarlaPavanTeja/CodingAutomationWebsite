"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

type Profile = { role: string; display_name: string | null; status: string };

type AuthContextType = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
});

// Module-level singleton — never recreated
const supabase = createClient();

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const voluntarySignOut = useRef(false);

  useEffect(() => {
    // Fetch user and profile on mount
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setUser(u);
      if (u) {
        supabase
          .from("profiles")
          .select("role, display_name, status")
          .eq("id", u.id)
          .single()
          .then(({ data, error }) => {
            if (!error) setProfile(data);
            setLoading(false);
          });
      } else {
        setLoading(false);
      }
    }).catch(() => setLoading(false));

    // Listen for login/logout/token refresh
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;

      // Detect involuntary sign-out (session expired)
      if (event === "SIGNED_OUT" && !voluntarySignOut.current) {
        sessionStorage.setItem("session_expired", "true");
        window.location.href = "/login";
        return;
      }
      voluntarySignOut.current = false;

      const u = session?.user ?? null;
      setUser(u);

      if (u) {
        supabase
          .from("profiles")
          .select("role, display_name, status")
          .eq("id", u.id)
          .single()
          .then(({ data }) => setProfile(data));
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    voluntarySignOut.current = true;
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    window.location.href = "/login";
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
