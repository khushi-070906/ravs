import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, CheckCircle2, Check, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { attachStudentNames } from "@/lib/people";
import { formatMinutes } from "@/lib/session-utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/research";
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

      <ul className="space-y-4">
        {shown.map((s) => {
          const waited = waitedDays(s.submitted_at ?? s.check_out_at);
          return (
            <li
              key={s.id}
              className="grid overflow-hidden rounded-lg border border-border bg-card md:grid-cols-[220px_minmax(0,1fr)]"
            >
              <div className="space-y-3 border-b border-border bg-muted/50 p-4 text-sm md:border-b-0 md:border-r">
                <div>
                  <p className="font-medium">{s.student_name}</p>
                  {s.student_college_id && (
                    <p className="text-xs text-muted-foreground">{s.student_college_id}</p>
                  )}
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
                {s.notes && <p className="mb-2 text-sm text-muted-foreground">Plan: {s.notes}</p>}
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
                        disabled={decide.isPending}
                      >
                        <Check className="size-4" /> Verify {formatMinutes(s.duration_minutes)}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decide.mutate({ id: s.id, approved: false })}
                        disabled={decide.isPending}
                      >
                        <Undo2 className="size-4" /> Return
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-auto pt-5 text-xs text-muted-foreground">Waiting for faculty.</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
