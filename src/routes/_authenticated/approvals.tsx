import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, CheckCircle2, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { attachStudentNames } from "@/lib/people";
import { formatMinutes } from "@/lib/session-utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/approvals")({
  head: () => ({
    meta: [
      { title: "Approval queue — RAVS" },
      { name: "description", content: "Review and verify student research sessions." },
      { property: "og:title", content: "Approval queue — RAVS" },
      { property: "og:description", content: "Approve or reject submitted work sessions." },
    ],
  }),
  component: Approvals,
});

function Approvals() {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const [remarks, setRemarks] = useState<Record<string, string>>({});
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
      if (!approved && !note) throw new Error("Add a remark explaining the rejection");
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
      toast.success(v.approved ? "Session approved" : "Session rejected");
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

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Approval Queue</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isFaculty
                ? "Global Review Queue: Verify student research sessions across all events."
                : "Institutional Review Queue: Global oversight of all pending student submissions."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border bg-secondary px-3 py-1 text-xs font-semibold uppercase tracking-wider text-secondary-foreground">
              Role: {role}
            </span>
          </div>
        </div>

        {/* Read-Only Banner for Admin */}
        {isAdmin && (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-600 dark:text-amber-400">
            <ShieldCheck className="size-5 shrink-0" />
            <div className="text-sm">
              <span className="font-semibold">Read-Only Oversight:</span> Admins can view all
              student submissions globally, but approval and rejection authority is reserved
              exclusively for Faculty.
            </div>
          </div>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading queue…</p>}

      {sessions && sessions.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <CheckCircle2 className="mx-auto size-10 text-emerald-500" />
          <p className="mt-3 text-base font-medium">All caught up!</p>
          <p className="mt-1 text-sm text-muted-foreground">
            There are currently no pending student sessions awaiting review.
          </p>
        </div>
      )}

      <ul className="space-y-4">
        {(sessions ?? []).map((s) => (
          <li key={s.id} className="rounded-xl border border-border bg-card p-5 shadow-xs">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-lg font-semibold">{s.student_name}</h2>
              {s.student_college_id && (
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {s.student_college_id}
                </span>
              )}
              <span className="ml-auto text-sm font-medium text-primary">
                {s.projects?.title ?? "General Event"}
              </span>
            </div>

            <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="size-3.5" />
              <span>
                {new Date(s.check_in_at).toLocaleString()} →{" "}
                {s.check_out_at ? new Date(s.check_out_at).toLocaleTimeString() : "—"} ·{" "}
                <strong className="text-foreground">{formatMinutes(s.duration_minutes)}</strong>
              </span>
            </p>

            {s.notes && (
              <p className="mt-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Objective:</span> {s.notes}
              </p>
            )}
            {s.summary && (
              <div className="mt-2 rounded-md bg-muted/40 p-3 text-sm whitespace-pre-line text-foreground">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                  Work Summary
                </span>
                {s.summary}
              </div>
            )}

            {/* Actions: Faculty can approve/reject, Admin sees read-only badge */}
            {isFaculty ? (
              <div className="mt-4 space-y-3 border-t border-border pt-4">
                <Textarea
                  rows={2}
                  placeholder="Review remarks (required if rejecting)"
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
                    Approve Session
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => decide.mutate({ id: s.id, approved: false })}
                    disabled={decide.isPending}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                <span>
                  Status:{" "}
                  <strong className="capitalize text-amber-500">Pending Faculty Approval</strong>
                </span>
                <span className="italic">Faculty approval required</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
