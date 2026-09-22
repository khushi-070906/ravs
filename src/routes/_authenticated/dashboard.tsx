import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, BookOpen, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { attachStudentNames } from "@/lib/people";
import { SessionWidget } from "@/components/session-widget";
import { formatMinutes, hoursFrom, startOfWeek, statusTone } from "@/lib/session-utils";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — RAVS" },
      { name: "description", content: "Your research sessions, hours and pending approvals." },
      { property: "og:title", content: "Dashboard — RAVS" },
      { property: "og:description", content: "Research attendance at a glance." },
    ],
  }),
  component: Dashboard,
});

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-3xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Dashboard() {
  const { role, profile } = useAuth();
  const firstName = (profile?.full_name || "").split(" ")[0];

  return (
    <div className="space-y-8">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">{firstName ? `Hello, ${firstName}` : "Dashboard"}</h1>
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {role ?? "member"}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {role === "admin"
            ? "Institutional oversight across all events, attendance, and student submissions."
            : role === "faculty"
              ? "Global review and verification for student research sessions."
              : "Log verified research work and track your personal attendance hours."}
        </p>
      </div>
      {role === "faculty" || role === "admin" ? <GlobalStaffView role={role} /> : <StudentView />}
    </div>
  );
}

function StudentView() {
  const { user } = useAuth();

  const { data: sessions } = useQuery({
    queryKey: ["student-sessions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // Students can ONLY view their own sessions
      const { data, error } = await supabase
        .from("work_sessions")
        .select("*, projects(title)")
        .eq("student_id", user!.id)
        .order("check_in_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const done = (sessions ?? []).filter((s) => s.status !== "active");
  const approved = done.filter((s) => s.status === "approved");
  const pending = done.filter((s) => s.status === "pending");
  const weekStart = startOfWeek();
  const weekMins = approved
    .filter((s) => new Date(s.check_in_at) >= weekStart)
    .reduce((a, s) => a + (s.duration_minutes ?? 0), 0);
  const approvedMins = approved.reduce((a, s) => a + (s.duration_minutes ?? 0), 0);
  const submittedMins = done.reduce((a, s) => a + (s.duration_minutes ?? 0), 0);
  const pct = submittedMins ? Math.round((approvedMins / submittedMins) * 100) : 0;

  return (
    <div className="space-y-8">
      <SessionWidget />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Approved hours"
          value={`${hoursFrom(approvedMins)}h`}
          hint="Counts for attendance"
        />
        <Stat label="This week" value={`${hoursFrom(weekMins)}h`} hint="Approved only" />
        <Stat label="Pending review" value={String(pending.length)} hint="Awaiting faculty" />
        <Stat label="Verification rate" value={`${pct}%`} hint="Approved of submitted" />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl">My recent sessions</h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/attendance">View attendance</Link>
          </Button>
        </div>
        <SessionList sessions={done.slice(0, 6)} empty="No completed sessions yet." />
      </div>
    </div>
  );
}

function GlobalStaffView({ role }: { role: "faculty" | "admin" }) {
  const { user } = useAuth();
  const isFaculty = role === "faculty";
  const isAdmin = role === "admin";

  const { data } = useQuery({
    queryKey: ["global-staff-overview", user?.id, role],
    enabled: !!user,
    queryFn: async () => {
      // Global visibility across all projects and all student sessions
      const [
        { data: projects, error: pErr },
        { data: sessions, error: sErr },
        { data: members, error: mErr },
      ] = await Promise.all([
        supabase
          .from("projects")
          .select("id, title, status")
          .order("created_at", { ascending: false }),
        supabase
          .from("work_sessions")
          .select("*, projects(title)")
          .order("submitted_at", { ascending: false }),
        supabase.from("project_members").select("student_id"),
      ]);
      if (pErr) throw pErr;
      if (sErr) throw sErr;
      if (mErr) throw mErr;

      return {
        projects: projects ?? [],
        sessions: await attachStudentNames(sessions ?? []),
        students: new Set((members ?? []).map((m) => m.student_id)).size,
      };
    },
  });

  const sessions = data?.sessions ?? [];
  const pending = sessions.filter((s) => s.status === "pending");
  const approved = sessions.filter((s) => s.status === "approved");
  const reviewed = sessions.filter((s) => s.status !== "active" && s.status !== "pending");
  const rate = reviewed.length ? Math.round((approved.length / reviewed.length) * 100) : 0;

  return (
    <div className="space-y-8">
      {isAdmin && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-600 dark:text-amber-400">
          <ShieldCheck className="size-5 shrink-0" />
          <div className="text-sm">
            <span className="font-semibold">Admin Oversight Active:</span> Global visibility across
            all research events and students. Approvals are read-only for admin; only faculty have
            review/approval authority.
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Pending reviews"
          value={String(pending.length)}
          hint="Awaiting faculty action"
        />
        <Stat
          label="Active events"
          value={String((data?.projects ?? []).filter((p) => p.status === "active").length)}
          hint="Institution-wide"
        />
        <Stat
          label="Enrolled students"
          value={String(data?.students ?? 0)}
          hint="Across all events"
        />
        <Stat label="Approval rate" value={`${rate}%`} hint="Of reviewed sessions" />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isFaculty ? (
              <BookOpen className="size-5 text-primary" />
            ) : (
              <Clock className="size-5 text-primary" />
            )}
            <h2 className="text-xl font-semibold">
              {isFaculty ? "Pending faculty review" : "Global pending submissions"}
            </h2>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/approvals">
              {isFaculty ? "Open review queue" : "View queue (Read-Only)"}
            </Link>
          </Button>
        </div>
        <SessionList
          sessions={pending.slice(0, 6)}
          showStudent
          empty="Nothing pending. All submissions are caught up."
        />
      </div>
    </div>
  );
}

type Row = {
  id: string;
  status: string;
  check_in_at: string;
  duration_minutes: number | null;
  summary: string | null;
  projects?: { title: string } | null;
  student_name?: string;
};

export function SessionList({
  sessions,
  empty,
  showStudent,
}: {
  sessions: Row[];
  empty: string;
  showStudent?: boolean;
}) {
  if (sessions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        {empty}
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {sessions.map((s) => (
        <li key={s.id} className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{s.projects?.title ?? "Event"}</span>
            {showStudent && s.student_name && (
              <span className="text-sm text-muted-foreground">{s.student_name}</span>
            )}
            <span
              className={`ml-auto rounded-full border px-2.5 py-0.5 text-xs capitalize ${statusTone(s.status)}`}
            >
              {s.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {new Date(s.check_in_at).toLocaleString()} · {formatMinutes(s.duration_minutes)}
          </p>
          {s.summary && <p className="mt-2 line-clamp-2 text-sm">{s.summary}</p>}
        </li>
      ))}
    </ul>
  );
}
