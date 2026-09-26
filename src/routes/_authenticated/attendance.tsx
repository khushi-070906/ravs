import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { attachStudentNames } from "@/lib/people";
import { formatMinutes, hoursFrom } from "@/lib/session-utils";
import {
  ActivityGrid,
  HoursProgress,
  MetricStrip,
  PageHeader,
  RecommendationBadge,
  StatusBadge,
  downloadCsv,
} from "@/components/research";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

  const [eventFilter, setEventFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [who, setWho] = useState("");
  const [shown, setShown] = useState(50);
  const [recFilter, setRecFilter] = useState("all");
  const { data: recs } = useQuery({
    queryKey: ["recommendations-named", user?.id, role],
    enabled: !!user && !!role,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("attendance_recommendations", {});
      if (error) throw error;
      return attachStudentNames(data ?? []);
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading attendance record…</p>;

  const all = data?.sessions ?? [];
  const projects = data?.projects ?? [];
  const titleOf = (s: (typeof all)[number]) =>
    s.projects?.title ?? projects.find((p) => p.id === s.project_id)?.title ?? "Event";
  const q = who.trim().toLowerCase();
  const rows = all.filter(
    (s) =>
      (eventFilter === "all" || s.project_id === eventFilter) &&
      (statusFilter === "all" || s.status === statusFilter) &&
      (!q ||
        s.student_name.toLowerCase().includes(q) ||
        (s.student_college_id ?? "").toLowerCase().includes(q)),
  );
  const mins = (st: string) =>
    rows.filter((s) => s.status === st).reduce((a, s) => a + (s.duration_minutes ?? 0), 0);

  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const recRows = (recs ?? []).filter((r) => recFilter === "all" || r.recommendation === recFilter);
  const recCount = (k: string) => (recs ?? []).filter((r) => r.recommendation === k).length;

  function exportCsv() {
    downloadCsv(`ravs-attendance-${new Date().toISOString().slice(0, 10)}.csv`, [
      [
        "Date",
        "Check in",
        "Check out",
        "Minutes",
        ...(isStaff ? ["Student", "College ID"] : []),
        "Event",
        "Status",
        "Summary",
        "Reviewer remark",
      ],
      ...rows.map((s) => [
        new Date(s.check_in_at).toLocaleDateString(),
        new Date(s.check_in_at).toLocaleTimeString(),
        s.check_out_at ? new Date(s.check_out_at).toLocaleTimeString() : "",
        s.duration_minutes ?? "",
        ...(isStaff ? [s.student_name, s.student_college_id ?? ""] : []),
        titleOf(s),
        s.status,
        s.summary ?? "",
        s.remarks ?? "",
      ]),
    ]);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Attendance record"
        intro={
          isStaff
            ? "Every completed research session, with who verified it. Export it for departmental records."
            : "Your completed sessions and their verification. Only verified time counts toward attendance."
        }
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="size-4" /> Export CSV
          </Button>
        }
      />

      <MetricStrip
        items={[
          {
            label: "Verified",
            value: `${hoursFrom(mins("approved"))}h`,
            hint: plural(rows.filter((s) => s.status === "approved").length, "session"),
          },
          {
            label: "Awaiting review",
            value: `${hoursFrom(mins("pending"))}h`,
            hint: plural(rows.filter((s) => s.status === "pending").length, "session"),
          },
          {
            label: "Returned",
            value: `${hoursFrom(mins("rejected"))}h`,
            hint: plural(rows.filter((s) => s.status === "rejected").length, "session"),
          },
          {
            label: "Sessions shown",
            value: String(rows.length),
            hint: eventFilter === "all" ? "All events" : "Filtered",
          },
        ]}
      />

      <ActivityGrid
        sessions={rows}
        weeks={26}
        title={isStaff ? "Verified time, all students" : "Verified time"}
      />

      <section className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h2 className="text-xl">Attendance recommendations</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Verified hours against each event's requirement, paced by the term dates.
            </p>
          </div>
          {isStaff && (
            <>
              <Select value={recFilter} onValueChange={setRecFilter}>
                <SelectTrigger className="h-9 w-44" aria-label="Filter recommendations">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone ({(recs ?? []).length})</SelectItem>
                  <SelectItem value="eligible">Eligible ({recCount("eligible")})</SelectItem>
                  <SelectItem value="on_track">On track ({recCount("on_track")})</SelectItem>
                  <SelectItem value="at_risk">At risk ({recCount("at_risk")})</SelectItem>
                  <SelectItem value="behind">Behind ({recCount("behind")})</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                disabled={recRows.length === 0}
                onClick={() =>
                  downloadCsv(`ravs-recommendations-${new Date().toISOString().slice(0, 10)}.csv`, [
                    [
                      "Student",
                      "College ID",
                      "Event",
                      "Verified hours",
                      "Required hours",
                      "Progress %",
                      "Expected %",
                      "Recommendation",
                      "Reason",
                    ],
                    ...recRows.map((r) => [
                      r.student_name,
                      r.student_college_id ?? "",
                      projects.find((p) => p.id === r.project_id)?.title ?? "",
                      hoursFrom(r.verified_minutes),
                      r.required_hours,
                      r.progress_pct,
                      r.expected_pct ?? "",
                      r.recommendation,
                      r.reason,
                    ]),
                  ])
                }
              >
                <Download className="size-4" /> CSV
              </Button>
            </>
          )}
        </div>
        {recRows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
            {isStaff ? "No enrolments to assess yet." : "Join an event to see where you stand."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  {isStaff && <th className="px-4 py-3 font-medium">Student</th>}
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="w-56 px-4 py-3 font-medium">Progress</th>
                  <th className="px-4 py-3 font-medium">Recommendation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recRows.map((r) => (
                  <tr key={`${r.student_id}-${r.project_id}`} className="align-top">
                    {isStaff && (
                      <td className="px-4 py-3">
                        <span className="font-medium">{r.student_name}</span>
                        {r.student_college_id && (
                          <span className="block text-xs text-muted-foreground">
                            {r.student_college_id}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      {projects.find((p) => p.id === r.project_id)?.title ?? "Event"}
                    </td>
                    <td className="px-4 py-3">
                      <HoursProgress
                        compact
                        approvedMins={Number(r.verified_minutes)}
                        pendingMins={Number(r.pending_minutes)}
                        requiredHours={Number(r.required_hours)}
                      />
                      {r.expected_pct != null && (
                        <p className="tnum mt-1 text-[11px] text-muted-foreground">
                          {Math.round(Number(r.expected_pct))}% of term elapsed
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <RecommendationBadge value={r.recommendation} />
                      <p className="mt-0.5 text-xs text-muted-foreground">{r.reason}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-xl">Session ledger</h2>
          {isStaff && (
            <Input
              aria-label="Filter by student"
              placeholder="Student name or ID"
              className="h-9 w-44"
              value={who}
              onChange={(e) => setWho(e.target.value)}
            />
          )}
          <Select value={eventFilter} onValueChange={setEventFilter}>
            <SelectTrigger className="h-9 w-48" aria-label="Filter by event">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-40" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              <SelectItem value="approved">Verified</SelectItem>
              <SelectItem value="pending">Awaiting review</SelectItem>
              <SelectItem value="rejected">Returned</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            {all.length === 0
              ? "No completed sessions yet. Check out of a session and it will be recorded here."
              : "No sessions match these filters."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Time</th>
                  {isStaff && <th className="px-4 py-3 font-medium">Student</th>}
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 text-right font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.slice(0, shown).map((s) => (
                  <tr key={s.id} className="align-top">
                    <td className="tnum whitespace-nowrap px-4 py-3">
                      {new Date(s.check_in_at).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="tnum whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {new Date(s.check_in_at).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {s.check_out_at &&
                        `–${new Date(s.check_out_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
                    </td>
                    {isStaff && (
                      <td className="px-4 py-3">
                        <span className="font-medium">{s.student_name}</span>
                        {s.student_college_id && (
                          <span className="block text-xs text-muted-foreground">
                            {s.student_college_id}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      {titleOf(s)}
                      {s.summary && (
                        <span className="mt-0.5 block max-w-sm font-serif text-[14px] leading-snug text-muted-foreground line-clamp-2">
                          {s.summary}
                        </span>
                      )}
                      {s.remarks && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          Reviewer: {s.remarks}
                        </span>
                      )}
                    </td>
                    <td className="tnum whitespace-nowrap px-4 py-3 text-right">
                      {formatMinutes(s.duration_minutes)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge status={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > shown && (
          <Button variant="outline" onClick={() => setShown(shown + 100)}>
            Show more ({rows.length - shown} older)
          </Button>
        )}
      </section>
    </div>
  );
}
