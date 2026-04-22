"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";

export type AuthUser = { id: string; email: string };
export type Profile = {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  status: string;
};

type AuthContextType = {
  user: AuthUser | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (!res.ok) {
        setUser(null);
        setProfile(null);
        return;
      }
      const data = await res.json();
      setUser(data.user);
      setProfile(data.profile);
    } catch {
      setUser(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Best-effort
    }
    setUser(null);
    setProfile(null);
    window.location.href = "/login";
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
