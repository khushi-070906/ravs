import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Play, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { elapsedMinutes, liveClock } from "@/lib/session-utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SessionWidget() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [summary, setSummary] = useState("");
  const [, setTick] = useState(0);

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

  const { data: active } = useQuery({
    queryKey: ["active-session", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_sessions")
        .select("*, projects(title)")
        .eq("student_id", user!.id)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  const checkIn = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("Pick an event first");
      const { error } = await supabase.from("work_sessions").insert({
        project_id: projectId,
        student_id: user!.id,
        notes: notes || null,
        status: "active",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNotes("");
      toast.success("Checked in — timer running");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const checkOut = useMutation({
    mutationFn: async () => {
      if (!summary.trim()) throw new Error("Add a work summary before submitting");
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("work_sessions")
        .update({
          check_out_at: now,
          duration_minutes: elapsedMinutes(active!.check_in_at),
          summary: summary.trim(),
          status: "pending",
          submitted_at: now,
        })
        .eq("id", active!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setSummary("");
      toast.success("Session submitted for faculty approval");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (active) {
    return (
      <div className="rounded-lg border border-accent/40 bg-accent/8 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Session running</p>
            <h2 className="mt-1 text-lg">{active.projects?.title}</h2>
          </div>
          <p className="font-display text-4xl tabular-nums">{liveClock(active.check_in_at)}</p>
        </div>
        {active.notes && (
          <p className="mt-3 text-sm text-muted-foreground">Notes: {active.notes}</p>
        )}
        <div className="mt-5 space-y-2">
          <Label htmlFor="summary">Work summary</Label>
          <Textarea
            id="summary"
            rows={4}
            placeholder="What did you do in this session?"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={2000}
          />
        </div>
        <Button className="mt-4" onClick={() => checkOut.mutate()} disabled={checkOut.isPending}>
          <Square className="size-4" /> Check out &amp; submit
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">No active session</p>
      <h2 className="mt-1 text-lg">Start research work</h2>

      {memberships && memberships.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          You aren't enrolled in an event yet. Open Events and join one to start logging work.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label>Event</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Select an event" />
              </SelectTrigger>
              <SelectContent>
                {(memberships ?? []).map((m) => (
                  <SelectItem key={m.project_id} value={m.project_id}>
                    {m.projects!.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Session note (optional)</Label>
            <Textarea
              id="notes"
              rows={2}
              placeholder="What are you planning to work on?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
            />
          </div>
          <Button onClick={() => checkIn.mutate()} disabled={checkIn.isPending}>
            <Play className="size-4" /> Check in
          </Button>
        </div>
      )}
    </div>
  );
}
