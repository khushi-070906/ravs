import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, MapPin, Play, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { elapsedMinutes, liveClock } from "@/lib/session-utils";
import { assertCheckedIn, checkInFlagHint, getPosition, positionArgs } from "@/lib/presence";
import { useInstitution } from "@/lib/institution";
import { Input } from "@/components/ui/input";
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
  const [code, setCode] = useState("");
  const [, setTick] = useState(0);
  const { data: institution } = useInstitution();
  const maxMins = institution?.max_session_minutes ?? 480;

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
      const pos = await getPosition();
      const { data, error } = await supabase.rpc("check_in", {
        p_project: projectId,
        p_notes: notes.trim() || null,
        p_code: code.trim() || null,
        ...positionArgs(pos),
      });
      if (error) throw error;
      return assertCheckedIn(data);
    },
    onSuccess: (row) => {
      setNotes("");
      setCode("");
      const flags = row?.flags ?? [];
      if (flags.length === 0) toast.success("Checked in — presence verified");
      else
        toast.warning("Checked in, but flagged for review", {
          description: checkInFlagHint(flags),
        });
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const checkOut = useMutation({
    mutationFn: async () => {
      if (!summary.trim()) throw new Error("Add a work summary before submitting");
      const pos = await getPosition();
      const { error } = await supabase.rpc("check_out", {
        p_session: active!.id,
        p_summary: summary.trim(),
        ...positionArgs(pos),
      });
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
      <section
        aria-label="Running session"
        className="overflow-hidden rounded-xl bg-sidebar text-sidebar-foreground"
      >
        <div className="graph-paper flex flex-wrap items-end justify-between gap-4 px-6 pb-5 pt-6">
          <div>
            <p className="flex items-center gap-2 text-sm text-sidebar-foreground/70">
              <span className="pulse-dot size-2 rounded-full bg-accent" aria-hidden />
              Checked in
            </p>
            <h2 className="mt-1 text-xl text-sidebar-primary">{active.projects?.title}</h2>
          </div>
          <p
            className="tnum font-display text-5xl font-semibold leading-none text-sidebar-primary sm:text-6xl"
            aria-live="off"
          >
            {liveClock(active.check_in_at)}
          </p>
        </div>
        <div className="space-y-3 bg-card p-6 text-card-foreground">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              {active.check_in_method === "code" ? (
                <>
                  <KeyRound className="size-3.5" /> Checked in with lab code
                </>
              ) : (
                <>
                  <KeyRound className="size-3.5" /> No lab code
                </>
              )}
            </span>
            {active.check_in_lat != null && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" /> Location recorded
              </span>
            )}
            <span>
              Closes automatically after {Math.round((maxMins / 60) * 10) / 10}h
              {elapsedMinutes(active.check_in_at) > maxMins - 30 && " — check out soon"}
            </span>
          </p>
          {active.notes && <p className="text-sm text-muted-foreground">Notes: {active.notes}</p>}
          <Label htmlFor="summary">What did you work on?</Label>
          <Textarea
            id="summary"
            rows={3}
            placeholder="e.g. Ran the INT8 benchmark on the Jetson and logged FPS"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={2000}
          />
          <Button onClick={() => checkOut.mutate()} disabled={checkOut.isPending}>
            <Square className="size-4" /> Check out and submit
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg">Start a session</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick the event you're working on and check in. Your time starts now.
      </p>

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
            <Label htmlFor="lab-code">Lab code</Label>
            <Input
              id="lab-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code on the lab screen"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
              className="tnum w-56 tracking-[0.3em]"
            />
            <p className="text-xs text-muted-foreground">
              Or scan the QR code in the lab with your phone camera. Without a code, your session is
              flagged for your supervisor. Your location is recorded at check-in and check-out.
            </p>
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
