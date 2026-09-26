import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Department = { id: string; name: string; code: string | null; head_id: string | null };
export type Lab = {
  id: string;
  name: string;
  department_id: string | null;
  location: string | null;
  incharge_id: string | null;
  capacity: number | null;
};
export type Recommendation = "eligible" | "on_track" | "at_risk" | "behind";

export function useDepartments() {
  return useQuery({
    queryKey: ["departments"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Department[];
    },
  });
}

export function useLabs() {
  return useQuery({
    queryKey: ["labs"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("labs").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Lab[];
    },
  });
}

export function useInstitution() {
  return useQuery({
    queryKey: ["institution"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("institution_settings").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/** Faculty + admins, for supervisor pickers. */
export function useStaff() {
  return useQuery({
    queryKey: ["staff-people"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["faculty", "admin"]);
      const ids = (roles ?? []).map((r) => r.user_id);
      if (ids.length === 0) return [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      return (profiles ?? []).map((p) => ({ id: p.id, name: p.full_name || "Unnamed" }));
    },
  });
}

export function useRecommendations(projectId?: string, enabled = true) {
  return useQuery({
    queryKey: ["recommendations", projectId ?? "all"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "attendance_recommendations",
        projectId ? { p_project: projectId } : {},
      );
      if (error) throw error;
      return data ?? [];
    },
  });
}
