import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { attachStudentNames } from "@/lib/people";
import { SessionWidget } from "@/components/session-widget";
import {
  ActivityGrid,
  HoursProgress,
  MetricStrip,
  PageHeader,
  RecommendationBadge,
  ResearchLog,
  StatusBadge,
} from "@/components/research";
import { useRecommendations } from "@/lib/institution";
import { hoursFrom, startOfWeek } from "@/lib/session-utils";
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

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Dashboard() {
  const { role, profile } = useAuth();
  const firstName = (profile?.full_name || "").split(" ").find((p) => !p.endsWith(".")) ?? "";

  return (
    <div className="space-y-8">
      <PageHeader
        title={firstName ? `${greeting()}, ${firstName}` : "Dashboard"}
        intro={
          role === "admin"
            ? "Oversight of every research event, its members and their verified hours."
            : role === "faculty"
              ? "Sessions waiting for your verification and how each event is progressing."
              : "Log your research time, then track what faculty have verified."
        }
      />
      {role === "faculty" || role === "admin" ? <StaffView role={role} /> : <StudentView />}
    </div>
  );
}

/* ------------------------------------------------------------------ student */

function StudentView() {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ["student-overview", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [{ data: sessions, error }, { data: memberships }] = await Promise.all([
        supabase
          .from("work_sessions")
          .select("*, projects(title)")
          .eq("student_id", user!.id)
          .order("check_in_at", { ascending: false }),
        supabase
          .from("project_members")
          .select("project_id, projects(id, title, status, required_hours, lab_name)")
          .eq("student_id", user!.id),
      ]);
      if (error) throw error;
      return { sessions: sessions ?? [], memberships: memberships ?? [] };
    },
  });

  const { data: recs } = useRecommendations(undefined, !!user);
  const { data: nextSlots } = useQuery({
    queryKey: ["next-slots", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("schedule_slots")
        .select("id, title, kind, starts_at, project_id, projects(title)")
        .gte("starts_at", new Date().toISOString())
        .order("starts_at")
        .limit(4);
      return data ?? [];
    },
  });
  const sessions = data?.sessions ?? [];
  const done = sessions.filter((s) => s.status !== "active");
  const approved = done.filter((s) => s.status === "approved");
  const pending = done.filter((s) => s.status === "pending");
  const mins = (xs: typeof sessions) => xs.reduce((a, s) => a + (s.duration_minutes ?? 0), 0);
  const weekStart = startOfWeek();
  const weekMins = mins(approved.filter((s) => new Date(s.check_in_at) >= weekStart));
  const submittedMins = mins(done.filter((s) => s.status !== "pending"));
  const pct = submittedMins ? Math.round((mins(approved) / submittedMins) * 100) : 0;

  return (
    <div className="space-y-8">
      <SessionWidget />

      <MetricStrip
        items={[
          {
            label: "Verified hours",
            value: `${hoursFrom(mins(approved))}h`,
            hint: "Counts toward attendance",
          },
          { label: "This week", value: `${hoursFrom(weekMins)}h`, hint: "Verified since Monday" },
          {
            label: "Awaiting review",
            value: String(pending.length),
            hint: `${hoursFrom(mins(pending))}h submitted`,
          },
          { label: "Acceptance rate", value: `${pct}%`, hint: "Of reviewed time" },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl">Research log</h2>
            <Button asChild variant="ghost" size="sm">
              <Link to="/attendance">Full record</Link>
            </Button>
          </div>
          <ResearchLog
            sessions={done.slice(0, 6)}
            empty="Your checked-out sessions will appear here as dated log entries."
          />
        </section>

        <aside className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <h2 className="text-base">Your events</h2>
            {(data?.memberships ?? []).length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                You haven't joined an event yet.{" "}
                <Link to="/projects" className="font-medium text-foreground underline">
                  Browse events
                </Link>
              </p>
            ) : (
              <ul className="mt-4 space-y-4">
                {(data?.memberships ?? []).map((m) => {
                  const p = m.projects;
                  if (!p) return null;
                  const mine = sessions.filter((s) => s.project_id === p.id);
                  return (
                    <li key={p.id}>
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <Link
                          to="/projects/$id"
                          params={{ id: p.id }}
                          className="text-sm font-medium leading-snug hover:underline"
                        >
                          {p.title}
                        </Link>
                        {p.status !== "active" ? (
                          <StatusBadge kind="event" status={p.status} />
                        ) : (
                          (() => {
                            const r = (recs ?? []).find((x) => x.project_id === p.id);
                            return r ? <RecommendationBadge value={r.recommendation} /> : null;
                          })()
                        )}
                      </div>
                      <HoursProgress
                        compact
                        approvedMins={mins(mine.filter((s) => s.status === "approved"))}
                        pendingMins={mins(mine.filter((s) => s.status === "pending"))}
                        requiredHours={p.required_hours}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <UpcomingCard slots={nextSlots ?? []} />
          <ActivityGrid sessions={sessions} weeks={13} />
        </aside>
      </div>
    </div>
  );
}

function UpcomingCard({
  slots,
}: {
  slots: {
    id: string;
    title: string;
    kind: string;
    starts_at: string;
    projects: { title: string } | null;
  }[];
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base">Coming up</h2>
        <Link to="/calendar" className="text-xs text-muted-foreground hover:underline">
          Calendar
        </Link>
      </div>
      {slots.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing scheduled.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {slots.map((s) => (
            <li key={s.id} className="flex gap-3">
              <span className="tnum w-11 shrink-0 text-center">
                <span className="block text-[10px] text-muted-foreground">
                  {new Date(s.starts_at).toLocaleDateString(undefined, { month: "short" })}
                </span>
                <span className="block font-display text-lg font-semibold leading-none">
                  {new Date(s.starts_at).getDate()}
                </span>
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{s.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {new Date(s.starts_at).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  , {s.projects?.title}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------- staff */

function StaffView({ role }: { role: "faculty" | "admin" }) {
  const { user } = useAuth();
  const isFaculty = role === "faculty";

  const { data } = useQuery({
    queryKey: ["staff-overview", user?.id, role],
    enabled: !!user,
    queryFn: async () => {
      const [
        { data: projects, error: pErr },
        { data: sessions, error: sErr },
        { data: members, error: mErr },
      ] = await Promise.all([
        supabase
          .from("projects")
          .select("id, title, status, required_hours, lab_name, faculty_id")
          .order("created_at", { ascending: false }),
        supabase
          .from("work_sessions")
          .select("*, projects(title)")
          .order("check_in_at", { ascending: false }),
        supabase.from("project_members").select("project_id, student_id"),
      ]);
      if (pErr) throw pErr;
      if (sErr) throw sErr;
      if (mErr) throw mErr;
      return {
        projects: projects ?? [],
        sessions: await attachStudentNames(sessions ?? []),
        members: members ?? [],
      };
    },
  });

  const { data: recs } = useQuery({
    queryKey: ["recommendations-attention", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("attendance_recommendations", {});
      if (error) throw error;
      return attachStudentNames(
        (data ?? []).filter((r) => r.recommendation === "behind" || r.recommendation === "at_risk"),
      );
    },
  });
  const sessions = data?.sessions ?? [];
  const projects = data?.projects ?? [];
  const members = data?.members ?? [];
  const pending = sessions.filter((s) => s.status === "pending");
  const approved = sessions.filter((s) => s.status === "approved");
  const reviewed = sessions.filter((s) => s.status === "approved" || s.status === "rejected");
  const rate = reviewed.length ? Math.round((approved.length / reviewed.length) * 100) : 0;
  const mins = (xs: typeof sessions) => xs.reduce((a, s) => a + (s.duration_minutes ?? 0), 0);
  const activeNow = sessions.filter((s) => s.status === "active").length;

  return (
    <div className="space-y-8">
      {role === "admin" && (
        <p className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-foreground" />
          You can see every event and record. Verifying sessions is left to faculty.
        </p>
      )}

      <MetricStrip
        items={[
          {
            label: "Awaiting review",
            value: String(pending.length),
            hint: `${hoursFrom(mins(pending))}h of research time`,
          },
          { label: "Checked in now", value: String(activeNow), hint: "Sessions in progress" },
          {
            label: "Verified hours",
            value: `${hoursFrom(mins(approved))}h`,
            hint: "Across all events",
          },
          {
            label: "Acceptance rate",
            value: `${rate}%`,
            hint: `${reviewed.length} sessions reviewed`,
          },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl">
              {isFaculty ? "Waiting for your review" : "Waiting for review"}
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link to="/approvals">{isFaculty ? "Review all" : "Open queue"}</Link>
            </Button>
          </div>
          <ResearchLog
            sessions={pending.slice(0, 5)}
            showStudent
            empty="No sessions are waiting for review."
          />
        </section>

        <aside className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base">Events</h2>
              <Link to="/projects" className="text-xs text-muted-foreground hover:underline">
                All events
              </Link>
            </div>
            <ul className="mt-4 space-y-4">
              {projects
                .filter((p) => p.status === "active")
                .slice(0, 6)
                .map((p) => {
                  const ps = sessions.filter((s) => s.project_id === p.id);
                  const people = members.filter((m) => m.project_id === p.id).length;
                  const waiting = ps.filter((s) => s.status === "pending").length;
                  return (
                    <li key={p.id}>
                      <Link
                        to="/projects/$id"
                        params={{ id: p.id }}
                        className="text-sm font-medium leading-snug hover:underline"
                      >
                        {p.title}
                      </Link>
                      <p className="tnum mt-0.5 text-xs text-muted-foreground">
                        {people} member{people === 1 ? "" : "s"}
                        {waiting > 0 && `, ${waiting} to review`}
                      </p>
                      <div className="mt-1.5">
                        <HoursProgress
                          compact
                          approvedMins={mins(ps.filter((s) => s.status === "approved"))}
                          pendingMins={mins(ps.filter((s) => s.status === "pending"))}
                          requiredHours={
                            p.required_hours ? p.required_hours * Math.max(people, 1) : null
                          }
                        />
                      </div>
                    </li>
                  );
                })}
              {projects.filter((p) => p.status === "active").length === 0 && (
                <li className="text-sm text-muted-foreground">No active events.</li>
              )}
            </ul>
          </section>
          <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base">Needs attention</h2>
              <Link to="/attendance" className="text-xs text-muted-foreground hover:underline">
                All students
              </Link>
            </div>
            {(recs ?? []).length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Every enrolled student is on pace.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {(recs ?? [])
                  .sort((a, b) => Number(a.progress_pct) - Number(b.progress_pct))
                  .slice(0, 5)
                  .map((r) => (
                    <li key={`${r.student_id}-${r.project_id}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{r.student_name}</span>
                        <RecommendationBadge value={r.recommendation} />
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {projects.find((p) => p.id === r.project_id)?.title}: {r.reason}
                      </p>
                    </li>
                  ))}
              </ul>
            )}
          </section>
          <ActivityGrid sessions={sessions} weeks={13} title="Verified time, all students" />
        </aside>
      </div>
    </div>
  );
}
