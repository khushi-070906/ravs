import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, CheckCircle2, Check, Undo2, CalendarOff, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { attachStudentNames } from "@/lib/people";
import { formatMinutes } from "@/lib/session-utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, StatusBadge } from "@/components/research";
import { FlagBadges, PresenceLine } from "@/components/presence-flags";
import { CorrectionReview } from "@/components/time-correction";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/approvals")({
  head: () => ({
    meta: [
      { title: "Review queue — RAVS" },
      { name: "description", content: "Review and verify student research sessions." },
      { property: "og:title", content: "Review queue — RAVS" },
      { property: "og:description", content: "Approve or reject submitted work sessions." },
    ],
  }),
  component: Approvals,
});

function Approvals() {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [eventFilter, setEventFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRemark, setBulkRemark] = useState("");
  const isFaculty = role === "faculty";
  const isAdmin = role === "admin";

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["approval-queue", user?.id, role],
    enabled: !!user && (isFaculty || isAdmin),
    queryFn: async () => {
      // Global visibility: Faculty and Admin view all pending submissions across all projects
      const { data, error } = await supabase
        .from("work_sessions")
        .select("*, projects(title)")
        .eq("status", "pending")
        .order("submitted_at", { ascending: true });
      if (error) throw error;
      return attachStudentNames(data ?? []);
    },
  });

  const decide = useMutation({
    mutationFn: async ({ id, approved }: { id: string; approved: boolean }) => {
      if (!isFaculty) {
        throw new Error("Only faculty members have authority to approve or reject sessions");
      }
      const note = (remarks[id] ?? "").trim();
      if (!approved && !note) throw new Error("Add a remark so the student knows what to fix");
      const { error } = await supabase
        .from("work_sessions")
        .update({
          status: approved ? "approved" : "rejected",
          remarks: note || null,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user!.id,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.approved ? "Session verified" : "Session returned to student");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulk = useMutation({
    mutationFn: async ({ ids, approved }: { ids: string[]; approved: boolean }) => {
      if (!isFaculty) throw new Error("Only faculty can verify or return sessions");
      if (ids.length === 0) throw new Error("Select at least one session");
      const note = bulkRemark.trim();
      if (!approved && !note) throw new Error("Add a remark so students know what to fix");
      const { data, error } = await supabase
        .from("work_sessions")
        .update({ status: approved ? "approved" : "rejected", remarks: note || null })
        .in("id", ids)
        .eq("status", "pending")
        // sessions with an open time correction must be resolved one by one
        .or("correction_status.is.null,correction_status.neq.pending")
        .select("id");
      if (error) throw error;
      return data?.length ?? 0;
    },
    onSuccess: (n, v) => {
      toast.success(
        `${n} session${n === 1 ? "" : "s"} ${v.approved ? "verified" : "returned to students"}`,
      );
      setSelected(new Set());
      setBulkRemark("");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (role === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (role !== "faculty" && role !== "admin") {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <h1 className="text-2xl font-bold">Access Restricted</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Only faculty members can review and approve student research sessions. Students can
          check-in and view verified attendance from their Dashboard.
        </p>
      </div>
    );
  }

  const all = sessions ?? [];
  const events = [
    ...new Map(all.map((s) => [s.project_id, s.projects?.title ?? "Event"])).entries(),
  ];
  const shown = eventFilter === "all" ? all : all.filter((s) => s.project_id === eventFilter);
  const shownIds = shown.map((x) => x.id);
  const picked = shownIds.filter((id) => selected.has(id));
  const pickedMins = shown
    .filter((x) => selected.has(x.id))
    .reduce((a, x) => a + (x.duration_minutes ?? 0), 0);
  const waitedDays = (d: string | null) =>
    d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Review queue"
        intro={
          isFaculty
            ? "Read each log entry and verify the time, or return it with a remark. Oldest first."
            : "Sessions waiting for faculty. Admins can read the queue but not verify."
        }
      />

      {isAdmin && (
        <p className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-foreground" />
          Read-only. Only faculty can verify or return sessions.
        </p>
      )}

      <Tabs defaultValue="sessions">
        <TabsList>
          <TabsTrigger value="sessions">
            Sessions <span className="tnum ml-1.5 opacity-70">{all.length}</span>
          </TabsTrigger>
          <TabsTrigger value="leave">Leave requests</TabsTrigger>
        </TabsList>
        <TabsContent value="leave" className="mt-6">
          <LeaveQueue canDecide={isFaculty} />
        </TabsContent>
        <TabsContent value="sessions" className="mt-6 space-y-6">
          {events.length > 1 && (
            <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter by event">
              {[["all", "All events"] as [string, string], ...events].map(([id, title]) => {
                const n = id === "all" ? all.length : all.filter((s) => s.project_id === id).length;
                return (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={eventFilter === id}
                    onClick={() => setEventFilter(id)}
                    className={cn(
                      "whitespace-nowrap rounded-md px-3 py-1.5 text-sm",
                      eventFilter === id
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    {title} <span className="tnum opacity-70">{n}</span>
                  </button>
                );
              })}
            </div>
          )}

          {isLoading && <p className="text-sm text-muted-foreground">Loading queue…</p>}

          {sessions && all.length === 0 && (
            <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
              <CheckCircle2 className="mx-auto size-8 text-success" />
              <p className="mt-3 font-medium">Nothing to review</p>
              <p className="mt-1 text-sm text-muted-foreground">
                New sessions appear here when students check out.
              </p>
            </div>
          )}

          {isFaculty && shown.length > 0 && (
            <div className="sticky top-0 z-10 space-y-3 rounded-lg border border-border bg-card/95 p-3 backdrop-blur">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={
                      shownIds.length > 0 && shownIds.every((id) => selected.has(id))
                        ? true
                        : shownIds.some((id) => selected.has(id))
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={(v) =>
                      setSelected(v === true ? new Set([...selected, ...shownIds]) : new Set())
                    }
                    aria-label="Select all shown"
                  />
                  Select all
                </label>
                <button
                  className="text-muted-foreground hover:text-foreground hover:underline"
                  onClick={() =>
                    setSelected(
                      new Set(
                        shown
                          .filter(
                            (x) =>
                              (x.flags ?? []).length === 0 && x.correction_status !== "pending",
                          )
                          .map((x) => x.id),
                      ),
                    )
                  }
                >
                  Select unflagged (
                  {
                    shown.filter(
                      (x) => (x.flags ?? []).length === 0 && x.correction_status !== "pending",
                    ).length
                  }
                  )
                </button>
                <span className="tnum ml-auto text-muted-foreground">
                  {picked.length} selected, {formatMinutes(pickedMins)}
                </span>
              </div>
              {picked.length > 0 && (
                <div className="flex flex-wrap items-start gap-2">
                  <Textarea
                    rows={1}
                    className="min-h-9 flex-1 basis-64"
                    placeholder="Remark for all selected (needed to return)"
                    value={bulkRemark}
                    onChange={(e) => setBulkRemark(e.target.value)}
                    maxLength={500}
                  />
                  <Button
                    size="sm"
                    onClick={() => bulk.mutate({ ids: picked, approved: true })}
                    disabled={bulk.isPending}
                  >
                    <Check className="size-4" /> Verify {picked.length}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => bulk.mutate({ ids: picked, approved: false })}
                    disabled={bulk.isPending}
                  >
                    <Undo2 className="size-4" /> Return {picked.length}
                  </Button>
                </div>
              )}
            </div>
          )}

          <ul className="space-y-4">
            {shown.map((s) => {
              const waited = waitedDays(s.submitted_at ?? s.check_out_at);
              return (
                <li
                  key={s.id}
                  className={cn(
                    "grid overflow-hidden rounded-lg border bg-card md:grid-cols-[220px_minmax(0,1fr)]",
                    (s.flags ?? []).length > 0 ? "border-warning/50" : "border-border",
                    selected.has(s.id) && "ring-2 ring-primary/40",
                  )}
                >
                  <div className="space-y-3 border-b border-border bg-muted/50 p-4 text-sm md:border-b-0 md:border-r">
                    <div className="flex items-start gap-2">
                      {isFaculty && (
                        <Checkbox
                          className="mt-0.5"
                          checked={selected.has(s.id)}
                          onCheckedChange={(v) => {
                            const next = new Set(selected);
                            if (v === true) next.add(s.id);
                            else next.delete(s.id);
                            setSelected(next);
                          }}
                          aria-label={`Select session by ${s.student_name}`}
                        />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium">{s.student_name}</p>
                        {s.student_college_id && (
                          <p className="text-xs text-muted-foreground">{s.student_college_id}</p>
                        )}
                      </div>
                    </div>
                    <Link
                      to="/projects/$id"
                      params={{ id: s.project_id }}
                      className="block text-sm leading-snug hover:underline"
                    >
                      {s.projects?.title ?? "Event"}
                    </Link>
                    <dl className="tnum space-y-1 text-xs text-muted-foreground">
                      <div>
                        <dt className="sr-only">Date</dt>
                        <dd>
                          {new Date(s.check_in_at).toLocaleDateString(undefined, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                        </dd>
                      </div>
                      <div>
                        <dt className="sr-only">Time</dt>
                        <dd>
                          {new Date(s.check_in_at).toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {s.check_out_at &&
                            `–${new Date(s.check_out_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
                        </dd>
                      </div>
                      <div>
                        <dt className="sr-only">Duration</dt>
                        <dd className="text-base font-semibold text-foreground">
                          {formatMinutes(s.duration_minutes)}
                        </dd>
                      </div>
                    </dl>
                    {waited >= 3 && (
                      <p className="text-xs font-medium text-warning-foreground">
                        Waiting {waited} days
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col p-4 sm:p-5">
                    <div className="mb-3 space-y-2">
                      <FlagBadges flags={s.flags} />
                      <PresenceLine s={s} />
                    </div>
                    <CorrectionReview
                      session={s}
                      remark={remarks[s.id] ?? ""}
                      canDecide={isFaculty}
                    />
                    {s.notes && (
                      <p className="mb-2 text-sm text-muted-foreground">Plan: {s.notes}</p>
                    )}
                    {s.summary ? (
                      <p className="whitespace-pre-line font-serif text-[16px] leading-relaxed">
                        {s.summary}
                      </p>
                    ) : (
                      <p className="text-sm italic text-muted-foreground">No summary written.</p>
                    )}

                    {isFaculty ? (
                      <div className="mt-auto space-y-3 pt-5">
                        <Textarea
                          rows={2}
                          aria-label={`Remark for ${s.student_name}`}
                          placeholder="Remark for the student (needed if you return it)"
                          value={remarks[s.id] ?? ""}
                          onChange={(e) => setRemarks({ ...remarks, [s.id]: e.target.value })}
                          maxLength={500}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => decide.mutate({ id: s.id, approved: true })}
                            disabled={decide.isPending || s.correction_status === "pending"}
                          >
                            <Check className="size-4" /> Verify {formatMinutes(s.duration_minutes)}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => decide.mutate({ id: s.id, approved: false })}
                            disabled={decide.isPending || s.correction_status === "pending"}
                          >
                            <Undo2 className="size-4" /> Return
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-auto pt-5 text-xs text-muted-foreground">
                        Waiting for faculty.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LeaveQueue({ canDecide }: { canDecide: boolean }) {
  const qc = useQueryClient();
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [showDone, setShowDone] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["leave-queue", showDone],
    queryFn: async () => {
      let q = supabase
        .from("leave_requests")
        .select("*, projects(title)")
        .order("starts_on", { ascending: true });
      q = showDone ? q.neq("status", "pending").limit(50) : q.eq("status", "pending");
      const { data, error } = await q;
      if (error) throw error;
      return attachStudentNames(data ?? []);
    },
  });

  const decide = useMutation({
    mutationFn: async ({ id, approved }: { id: string; approved: boolean }) => {
      const note = (remarks[id] ?? "").trim();
      if (!approved && !note) throw new Error("Add a remark when declining leave");
      const { error } = await supabase
        .from("leave_requests")
        .update({ status: approved ? "approved" : "rejected", remarks: note || null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.approved ? "Leave approved" : "Leave declined");
      qc.invalidateQueries({ queryKey: ["leave-queue"] });
      qc.invalidateQueries({ queryKey: ["recommendations"] });
      qc.invalidateQueries({ queryKey: ["recommendations-named"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  const days = (a: string, b: string) =>
    Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Approved leave excuses the student from scheduled lab sessions on those days, so their
          required hours drop accordingly.
        </p>
        <Button variant="outline" size="sm" onClick={() => setShowDone(!showDone)}>
          {showDone ? "Show pending" : "Show decided"}
        </Button>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && data.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <CalendarOff className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 font-medium">
            {showDone ? "No decided requests" : "No leave requests"}
          </p>
        </div>
      )}
      <ul className="space-y-3">
        {(data ?? []).map((r) => (
          <li key={r.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="font-medium">{r.student_name}</p>
              {r.student_college_id && (
                <p className="text-xs text-muted-foreground">{r.student_college_id}</p>
              )}
              <StatusBadge status={r.status} className="ml-auto" />
            </div>
            <p className="tnum mt-1 text-sm">
              {fmt(r.starts_on)}
              {r.ends_on !== r.starts_on && ` – ${fmt(r.ends_on)}`}
              <span className="text-muted-foreground">
                {"  "}· {days(r.starts_on, r.ends_on)} day
                {days(r.starts_on, r.ends_on) === 1 ? "" : "s"} ·{" "}
                {r.projects?.title ?? "All events"}
              </span>
            </p>
            <p className="mt-2 whitespace-pre-line font-serif text-[15px] leading-relaxed">
              {r.reason}
            </p>
            {r.remarks && (
              <p className="mt-2 border-l-2 border-border pl-3 text-sm text-muted-foreground">
                Reviewer: {r.remarks}
              </p>
            )}
            {canDecide && r.status === "pending" && (
              <div className="mt-3 space-y-2">
                <Textarea
                  rows={1}
                  placeholder="Remark (needed to decline)"
                  value={remarks[r.id] ?? ""}
                  onChange={(e) => setRemarks({ ...remarks, [r.id]: e.target.value })}
                  maxLength={500}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => decide.mutate({ id: r.id, approved: true })}
                    disabled={decide.isPending}
                  >
                    <Check className="size-4" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => decide.mutate({ id: r.id, approved: false })}
                    disabled={decide.isPending}
                  >
                    <X className="size-4" /> Decline
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
