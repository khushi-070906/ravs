import { supabase } from "@/integrations/supabase/client";

type WithStudent = { student_id: string } & Record<string, unknown>;

export type MemberWithDetails = {
  student_id: string;
  student_name: string;
  student_college_id: string | null;
  student_role: "student" | "faculty" | "admin";
} & Record<string, unknown>;

export async function attachStudentNames<T extends WithStudent>(rows: T[]) {
  const ids = [...new Set(rows.map((r) => r.student_id))];
  if (ids.length === 0)
    return rows.map((r) => ({
      ...r,
      student_name: "",
      student_college_id: null as string | null,
      student_role: "student" as "student" | "faculty" | "admin",
    }));

  const [{ data: profiles }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, college_id").in("id", ids),
    supabase.from("user_roles").select("user_id, role").in("user_id", ids),
  ]);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  const roleMap = new Map((roles ?? []).map((r) => [r.user_id, r.role]));

  return rows.map((r) => ({
    ...r,
    student_name: profileMap.get(r.student_id)?.full_name || "Unnamed member",
    student_college_id: profileMap.get(r.student_id)?.college_id ?? null,
    student_role: (roleMap.get(r.student_id) as "student" | "faculty" | "admin") || "student",
  }));
}
