import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, BookOpen, GraduationCap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { attachStudentNames } from "@/lib/people";
import { formatMinutes, statusTone } from "@/lib/session-utils";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance — RAVS" },
      { name: "description", content: "Verified research hours and attendance recommendations." },
      { property: "og:title", content: "Attendance — RAVS" },
      { property: "og:description", content: "Hours approved against event requirements." },
    ],
  }),
  component: Attendance,
});

function Attendance() {
  const { user, role } = useAuth();
  const isFaculty = role === "faculty";
  const isAdmin = role === "admin";
  const isStaff = isFaculty || isAdmin;

  const { data, isLoading } = useQuery({
    queryKey: ["attendance", user?.id, role],
    enabled: !!user && !!role,
    queryFn: async () => {
      const { data: projects, error: pErr } = await supabase
        .from("projects")
        .select("id, title")
        .order("created_at", { ascending: false });
      if (pErr) throw pErr;

      let query = supabase
        .from("work_sessions")
        .select("*, projects(title)")
        .neq("status", "active");

      // Students can ONLY view their own records
      if (!isStaff) {
        query = query.eq("student_id", user!.id);
      }

      const { data: sessions, error } = await query.order("check_in_at", { ascending: false });
      if (error) throw error;

      return {
        projects: projects ?? [],
        sessions: await attachStudentNames(sessions ?? []),
      };
    },
  });

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Loading attendance records…</p>;

  const sessions = data?.sessions ?? [];
  const projects = data?.projects ?? [];

  return (
    <div className="space-y-8">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">Attendance Records</h1>
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {isFaculty && <BookOpen className="size-3.5 text-primary" />}
            {isAdmin && <ShieldCheck className="size-3.5 text-amber-500" />}
            {!isStaff && <GraduationCap className="size-3.5 text-primary" />}
            <span>{role ?? "member"}</span>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {isStaff
            ? "Global log of completed student research sessions and faculty verification status."
            : "Your completed work sessions and faculty verification history."}
        </p>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold">
            {isStaff ? "All Verified & Completed Sessions" : "My Sessions"}
          </h2>
          <span className="text-xs text-muted-foreground">
            {sessions.length} record{sessions.length === 1 ? "" : "s"}
          </span>
        </div>

        {sessions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No completed sessions found.
          </p>
        ) : (
          <ul className="space-y-3">
            {sessions.map((s) => (
              <li key={s.id} className="rounded-xl border border-border bg-card p-4 shadow-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    {isStaff && s.student_name && (
                      <span className="font-semibold text-foreground">{s.student_name}</span>
                    )}
                    {isStaff && s.student_college_id && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {s.student_college_id}
                      </span>
                    )}
                    <span className="text-sm text-muted-foreground">
                      {isStaff ? "— " : ""}
                      {s.projects?.title ??
                        projects.find((p) => p.id === s.project_id)?.title ??
                        "Event"}
                    </span>
                  </div>

                  <span
                    className={`ml-auto rounded-full border px-2.5 py-0.5 text-xs capitalize ${statusTone(s.status)}`}
                  >
                    {s.status}
                  </span>
                </div>

                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(s.check_in_at).toLocaleString()} · {formatMinutes(s.duration_minutes)}
                </p>

                {s.remarks && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Faculty Remark:</span> {s.remarks}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
