import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PencilLine } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useInstitution } from "@/lib/institution";
import { formatMinutes } from "@/lib/session-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MIN_MINUTES = 15;
const MAX_DAYS_BACK = 14;

/** yyyy-mm-dd in the browser's local time, `days` before today. */
function localDate(days = 0) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

type ManualFields = { id: string; status: string; entry_type: string };

const isManual = (s: { entry_type?: string | null }) => s.entry_type === "manual";

/** Student: report time worked without running the timer. */
export function LogHoursDialog() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: institution } = useInstitution();
  const maxMins = institution?.max_session_minutes ?? 480;
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [date, setDate] = useState(localDate());
  const [time, setTime] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [summary, setSummary] = useState("");

  const { data: events } = useQuery({
    queryKey: ["manual-entry-events", user?.id],
    enabled: open && !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_members")
        .select("projects(id, title, status, faculty_id, co_supervisor_id)")
        .eq("student_id", user!.id);
      if (error) throw error;
      const projects = (data ?? [])
        .map((m) => m.projects)
        .filter((p): p is NonNullable<typeof p> => !!p && p.status !== "archived");
      const ids = [
        ...new Set(projects.flatMap((p) => [p.faculty_id, p.co_supervisor_id]).filter(Boolean)),
      ] as string[];
      const { data: people } = ids.length
        ? await supabase.from("profiles").select("id, full_name").in("id", ids)
        : { data: [] as { id: string; full_name: string | null }[] };
      const nameOf = new Map(
        (people ?? []).map((p) => [p.id, p.full_name || "Unnamed supervisor"]),
      );
      return projects.map((p) => ({
        id: p.id,
        title: p.title,
        supervisors: [p.faculty_id, p.co_supervisor_id]
          .filter((id): id is string => !!id && id !== user!.id)
          .map((id) => ({ id, name: nameOf.get(id) ?? "Unnamed supervisor" })),
      }));
    },
  });

  const event = (events ?? []).find((e) => e.id === project);
  const mins = (Number(hours) || 0) * 60 + (Number(minutes) || 0);
  const start = date && time ? new Date(`${date}T${time}`) : null;
  const end = start ? new Date(start.getTime() + mins * 60_000) : null;

  function problem(): string | null {
    if (!event) return "Pick the event or lab you worked on";
    if (!supervisor) return "Pick the supervisor who can confirm this";
    if (!start || Number.isNaN(start.getTime())) return "Enter the date and start time";
    if (date < localDate(MAX_DAYS_BACK) || date > localDate())
      return `Pick a date within the last ${MAX_DAYS_BACK} days`;
    if (mins < MIN_MINUTES || mins > maxMins)
      return `Duration must be between ${MIN_MINUTES} min and ${formatMinutes(maxMins)}`;
    if (end && end.getTime() > Date.now()) return "You can only log time that has already happened";
    if (summary.trim().length < 10) return "Describe the work you did (at least 10 characters)";
    return null;
  }

  const submit = useMutation({
    mutationFn: async () => {
      const p = problem();
      if (p) throw new Error(p);
      const { error } = await supabase.rpc("log_manual_session", {
        p_project: project,
        p_supervisor: supervisor,
        p_start: start!.toISOString(),
        p_end: end!.toISOString(),
        p_summary: summary.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Hours sent to your supervisor for verification");
      setOpen(false);
      setTime("");
      setHours("");
      setMinutes("");
      setSummary("");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function pickProject(id: string) {
    setProject(id);
    const sups = (events ?? []).find((e) => e.id === id)?.supervisors ?? [];
    setSupervisor(sups.length === 1 ? sups[0].id : "");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PencilLine className="size-4" /> Log hours manually
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log hours manually</DialogTitle>
          <DialogDescription>
            For time you worked without the timer. It's marked as a manual entry and your supervisor
            verifies it like any other session.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="manual-event">Event or lab</Label>
            <Select value={project} onValueChange={pickProject}>
              <SelectTrigger id="manual-event">
                <SelectValue placeholder={events ? "Choose an event" : "Loading…"} />
              </SelectTrigger>
              <SelectContent>
                {(events ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {events && events.length === 0 && (
              <p className="text-xs text-muted-foreground">Join an event first.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-supervisor">Supervisor</Label>
            <Select value={supervisor} onValueChange={setSupervisor} disabled={!event}>
              <SelectTrigger id="manual-supervisor">
                <SelectValue placeholder="Who can confirm this?" />
              </SelectTrigger>
              <SelectContent>
                {(event?.supervisors ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="manual-date">Date</Label>
              <Input
                id="manual-date"
                type="date"
                value={date}
                min={localDate(MAX_DAYS_BACK)}
                max={localDate()}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-time">Start time</Label>
              <Input
                id="manual-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-hours">Duration</Label>
            <div className="flex items-center gap-2">
              <Input
                id="manual-hours"
                type="number"
                inputMode="numeric"
                min={0}
                max={Math.floor(maxMins / 60)}
                className="w-20"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                aria-label="Hours"
              />
              <span className="text-sm text-muted-foreground">h</span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                step={5}
                className="w-20"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                aria-label="Minutes"
              />
              <span className="text-sm text-muted-foreground">min</span>
            </div>
            {mins > 0 && (
              <p className="tnum text-xs text-muted-foreground">
                This will count {formatMinutes(mins)}
                {end &&
                  !Number.isNaN(end.getTime()) &&
                  `, until ${end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-summary">What did you work on?</Label>
            <Textarea
              id="manual-summary"
              rows={3}
              maxLength={2000}
              placeholder="e.g. Cleaned the sensor dataset and re-ran the baseline model"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? "Sending…" : "Send for verification"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Student: "Manual entry" marker, with withdraw while it's still pending. */
export function ManualEntryStatus({
  session,
  showBadge = true,
}: {
  session: ManualFields;
  showBadge?: boolean;
}) {
  const qc = useQueryClient();
  const withdraw = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("withdraw_manual_session", { p_session: session.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Manual entry withdrawn");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isManual(session) || (!showBadge && session.status !== "pending")) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {showBadge && (
        <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 font-medium text-warning-foreground">
          <PencilLine className="size-3" /> Manual entry
        </span>
      )}
      {session.status === "pending" && (
        <button
          className="underline hover:text-foreground"
          onClick={() => withdraw.mutate()}
          disabled={withdraw.isPending}
        >
          Withdraw
        </button>
      )}
    </p>
  );
}

/** Faculty: context block for a manual entry inside a review card. */
export function ManualEntryReview({
  session,
  supervisorName,
  isYou,
}: {
  session: { entry_type?: string | null };
  supervisorName: string | null;
  isYou: boolean;
}) {
  if (!isManual(session)) return null;
  return (
    <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <PencilLine className="size-4" /> Manual entry, not tracked by the timer
      </p>
      <p className="mt-1 text-muted-foreground">
        {isYou
          ? "The student named you as the supervisor who can confirm this."
          : `The student named ${supervisorName ?? "a supervisor who is no longer listed"} as the supervisor who can confirm this.`}
      </p>
    </div>
  );
}
