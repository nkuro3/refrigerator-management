import type { Session } from "@supabase/supabase-js";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";

export type Profile = { user_id: string; display_name: string; notify_hour: number };
export type Household = { id: string; name: string };

type AuthState = {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  household: Household | null;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUserData = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setHousehold(null);
      return;
    }
    const [{ data: p }, { data: m }] = await Promise.all([
      supabase.from("profiles").select("user_id, display_name, notify_hour").eq("user_id", s.user.id).maybeSingle(),
      supabase.from("household_members").select("households(id, name)").eq("user_id", s.user.id).maybeSingle(),
    ]);
    setProfile(p as Profile | null);
    setHousehold(((m as { households: Household | null } | null)?.households) ?? null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadUserData(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // コールバック内で直接 await すると supabase-js がデッドロックするため遅延させる
      setTimeout(() => void loadUserData(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadUserData]);

  const refresh = useCallback(() => loadUserData(session), [loadUserData, session]);

  return (
    <AuthContext.Provider value={{ loading, session, profile, household, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

// 世帯に所属していることが前提の画面で使う
export function useHousehold(): Household {
  const { household } = useAuth();
  if (!household) throw new Error("household is not loaded");
  return household;
}
