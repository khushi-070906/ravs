import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "student" | "faculty" | "admin";

export type Profile = {
  id: string;
  full_name: string;
  college_id: string | null;
  department: string | null;
  phone: string | null;
  avatar_url: string | null;
};

type AuthState = {
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  role: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const queryClient = useQueryClient();

  async function load(userId: string) {
    try {
      let [{ data: roleRow }, { data: profileRow }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
        supabase
          .from("profiles")
          .select("id, full_name, college_id, department, phone, avatar_url")
          .eq("id", userId)
          .maybeSingle(),
      ]);

      if (!profileRow) {
        const { data: userResp } = await supabase.auth.getUser();
        const userMeta = userResp.user?.user_metadata;
        const newProfile = {
          id: userId,
          full_name: userMeta?.full_name || "",
          college_id: userMeta?.college_id || userMeta?.college || null,
        };
        try {
          await supabase.from("profiles").upsert(newProfile);
        } catch {
          // ignore upsert fallback error
        }
        profileRow = newProfile as Profile;
      }

      if (!roleRow) {
        // The DB is the only source of truth for roles; user_metadata is
        // client-writable and must never grant UI privileges.
        await supabase.rpc("ensure_own_student_role");
        const { data: healed } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .maybeSingle();
        roleRow = healed ?? { role: "student" };
      }

      setRole((roleRow?.role as AppRole) ?? "student");
      setProfile((profileRow as Profile) ?? null);
    } catch (err) {
      console.error("Failed to load user profile or role:", err);
    }
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user) await load(data.session.user.id);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      if (next?.user) {
        void load(next.user.id);
        void queryClient.invalidateQueries();
      } else {
        setRole(null);
        setProfile(null);
      }
      void router.invalidate();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        role,
        profile,
        loading,
        refreshProfile: async () => {
          if (session?.user) await load(session.user.id);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
