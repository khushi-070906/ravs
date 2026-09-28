import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarOff, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { StatusBadge } from "@/components/research";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "__all__";

function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

const fmt = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function LeavePanel() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState({ from: today(), to: today(), project: ALL, reason: "" });

  const { data: memberships } = useQuery({
    queryKey: ["my-projects", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_members")
        .select("project_id, projects(id, title, status)")
        .eq("student_id", user!.id);
      if (error) throw error;
      return (data ?? []).filter((m) => m.projects && m.projects.status !== "archived");
    },
  });

  const { data: requests } = useQuery({
    queryKey: ["my-leave", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("*, projects(title)")
        .eq("student_id", user!.id)
        .order("starts_on", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-leave"] });
    qc.invalidateQueries({ queryKey: ["recommendations-named"] });
    qc.invalidateQueries({ queryKey: ["recommendations"] });
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (!form.from || !form.to) throw new Error("Pick the dates");
      if (form.to < form.from) throw new Error("The end date is before the start date");
      if (form.reason.trim().length < 3) throw new Error("Give a short reason");
      const { error } = await supabase.from("leave_requests").insert({
        starts_on: form.from,
        ends_on: form.to,
        project_id: form.project === ALL ? null : form.project,
        reason: form.reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Leave requested. Your supervisor has been notified.");
      setForm({ from: today(), to: today(), project: ALL, reason: "" });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const withdraw = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("leave_requests").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Request withdrawn");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl">Leave</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Approved leave excuses you from scheduled lab sessions on those days, so they don't count
          against your attendance.
        </p>
      </div>

      <form
        className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[150px_150px_minmax(0,1fr)]"
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="leave-from">From</Label>
          <Input
            id="leave-from"
            type="date"
            value={form.from}
            onChange={(e) =>
              setForm({
                ...form,
                from: e.target.value,
                to: form.to < e.target.value ? e.target.value : form.to,
              })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="leave-to">To</Label>
          <Input
            id="leave-to"
            type="date"
            min={form.from}
            value={form.to}
            onChange={(e) => setForm({ ...form, to: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Event</Label>
          <Select value={form.project} onValueChange={(v) => setForm({ ...form, project: v })}>
            <SelectTrigger aria-label="Event">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All my events</SelectItem>
              {(memberships ?? []).map((m) => (
                <SelectItem key={m.project_id} value={m.project_id}>
                  {m.projects!.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 sm:col-span-2 lg:col-span-3">
          <Label htmlFor="leave-reason">Reason</Label>
          <Textarea
            id="leave-reason"
            rows={2}
            maxLength={1000}
            placeholder="e.g. University exam on both days"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <Button type="submit" disabled={submit.isPending}>
            <CalendarOff className="size-4" /> Request leave
          </Button>
        </div>
      </form>

      {(requests ?? []).length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {(requests ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-3 p-4 text-sm">
              <div className="min-w-0 flex-1">
                <p className="tnum font-medium">
                  {fmt(r.starts_on)}
                  {r.ends_on !== r.starts_on && ` – ${fmt(r.ends_on)}`}
                  <span className="font-normal text-muted-foreground">
                    {"  "}· {r.projects?.title ?? "All events"}
                  </span>
                </p>
                <p className="mt-0.5 text-muted-foreground">{r.reason}</p>
                {r.remarks && (
                  <p className="mt-1 text-xs text-muted-foreground">Reviewer: {r.remarks}</p>
                )}
              </div>
              <StatusBadge status={r.status} />
              {r.status === "pending" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  aria-label="Withdraw request"
                  onClick={() => withdraw.mutate(r.id)}
                  disabled={withdraw.isPending}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
