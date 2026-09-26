import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarPlus, ChevronLeft, ChevronRight, Download, MapPin, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useLabs } from "@/lib/institution";
import { formatMinutes } from "@/lib/session-utils";
import { PageHeader } from "@/components/research";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — RAVS" },
      { name: "description", content: "Lab sessions, meetings, reviews and deadlines." },
    ],
  }),
  component: CalendarPage,
});

const KIND: Record<string, { label: string; chip: string; bar: string }> = {
  lab_session: { label: "Lab session", chip: "bg-primary/10 text-primary", bar: "bg-primary" },
  meeting: { label: "Meeting", chip: "bg-accent/12 text-accent", bar: "bg-accent" },
  review: { label: "Review", chip: "bg-warning/20 text-warning-foreground", bar: "bg-warning" },
  deadline: {
    label: "Deadline",
    chip: "bg-destructive/10 text-destructive",
    bar: "bg-destructive",
  },
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Slot = {
  id: string;
  project_id: string;
  title: string;
  kind: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  lab_id: string | null;
  notes: string | null;
  series_id: string | null;
  projects?: { title: string } | null;
};

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
const hm = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const pad = (n: number) => String(n).padStart(2, "0");
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function icsStamp(iso: string) {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function downloadIcs(slots: Slot[]) {
  const esc = (s: string) => s.replace(/[\\;,]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RAVS//Research schedule//EN",
    ...slots.flatMap((s) => [
      "BEGIN:VEVENT",
      `UID:${s.id}@ravs`,
      `DTSTAMP:${icsStamp(new Date().toISOString())}`,
      `DTSTART:${icsStamp(s.starts_at)}`,
      `DTEND:${icsStamp(s.ends_at)}`,
      `SUMMARY:${esc(`${s.title} (${s.projects?.title ?? "RAVS"})`)}`,
      ...(s.location ? [`LOCATION:${esc(s.location)}`] : []),
      ...(s.notes ? [`DESCRIPTION:${esc(s.notes)}`] : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "ravs-schedule.ics";
  a.click();
  URL.revokeObjectURL(url);
}

function CalendarPage() {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const isStaff = role === "faculty" || role === "admin";
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<Date>(today);
  const [eventFilter, setEventFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  // 6-week grid starting on Monday
  const gridStart = useMemo(() => {
    const d = new Date(cursor);
    d.setDate(1 - ((d.getDay() + 6) % 7));
    d.setHours(0, 0, 0, 0);
    return d;
  }, [cursor]);
  const gridEnd = useMemo(() => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + 42);
    return d;
  }, [gridStart]);
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const { data: projects } = useQuery({
    queryKey: ["calendar-projects", user?.id, role],
    enabled: !!user && !!role,
    queryFn: async () => {
      const [{ data: ps }, { data: mine }] = await Promise.all([
        supabase
          .from("projects")
          .select("id, title, status, faculty_id, co_supervisor_id")
          .order("title"),
        supabase.from("project_members").select("project_id").eq("student_id", user!.id),
      ]);
      const joined = new Set((mine ?? []).map((m) => m.project_id));
      return (ps ?? []).map((p) => ({
        ...p,
        joined: joined.has(p.id),
        manageable:
          role === "admin" || p.faculty_id === user!.id || p.co_supervisor_id === user!.id,
      }));
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["calendar", user?.id, role, gridStart.toISOString()],
    enabled: !!user && !!role,
    queryFn: async () => {
      let sq = supabase
        .from("work_sessions")
        .select("id, project_id, check_in_at, duration_minutes, status")
        .gte("check_in_at", gridStart.toISOString())
        .lt("check_in_at", gridEnd.toISOString());
      if (!isStaff) sq = sq.eq("student_id", user!.id);
      const [{ data: slots, error }, { data: sessions }] = await Promise.all([
        supabase
          .from("schedule_slots")
          .select("*, projects(title)")
          .gte("starts_at", gridStart.toISOString())
          .lt("starts_at", gridEnd.toISOString())
          .order("starts_at"),
        sq,
      ]);
      if (error) throw error;
      return { slots: (slots ?? []) as Slot[], sessions: sessions ?? [] };
    },
  });

  const { data: upcoming } = useQuery({
    queryKey: ["calendar-upcoming", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("schedule_slots")
        .select("*, projects(title)")
        .gte("starts_at", new Date().toISOString())
        .order("starts_at")
        .limit(40);
      return (data ?? []) as Slot[];
    },
  });

  const removeSlot = useMutation({
    mutationFn: async (s: { id: string; series_id: string | null; all: boolean }) => {
      const q = supabase.from("schedule_slots").delete();
      const { error } =
        s.all && s.series_id ? await q.eq("series_id", s.series_id) : await q.eq("id", s.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removed from schedule");
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["calendar-upcoming"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const visible = (projectId: string) => {
    if (eventFilter !== "all") return projectId === eventFilter;
    if (isStaff) return true;
    return (projects ?? []).some((p) => p.id === projectId && p.joined);
  };
  const slots = (data?.slots ?? []).filter((s) => visible(s.project_id));
  const sessions = (data?.sessions ?? []).filter((s) => visible(s.project_id));
  const upcomingShown = (upcoming ?? []).filter((s) => visible(s.project_id)).slice(0, 8);
  const daySlots = slots.filter((s) => sameDay(new Date(s.starts_at), selected));
  const daySessions = sessions.filter(
    (s) => s.status !== "active" && sameDay(new Date(s.check_in_at), selected),
  );
  const manageable = (projects ?? []).filter((p) => p.manageable && p.status === "active");
  const canManage = (projectId: string) =>
    (projects ?? []).some((p) => p.id === projectId && p.manageable);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        intro={
          isStaff
            ? "Schedule lab sessions, meetings, reviews and deadlines. Members are notified when you add one."
            : "Lab sessions, meetings and deadlines for the events you've joined, next to the time you've logged."
        }
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => downloadIcs(upcomingShown)}
              disabled={upcomingShown.length === 0}
            >
              <Download className="size-4" /> Export .ics
            </Button>
            {isStaff && manageable.length > 0 && (
              <Button onClick={() => setDialogOpen(true)}>
                <CalendarPlus className="size-4" /> Schedule
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="min-w-40 text-center text-lg">
            {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="ml-1"
            onClick={() => {
              setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
              setSelected(today);
            }}
          >
            Today
          </Button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="hidden items-center gap-3 text-xs text-muted-foreground md:flex">
            {Object.entries(KIND).map(([k, v]) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", v.bar)} /> {v.label}
              </span>
            ))}
          </div>
          <Select value={eventFilter} onValueChange={setEventFilter}>
            <SelectTrigger className="h-9 w-48" aria-label="Filter by event">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isStaff ? "All events" : "My events"}</SelectItem>
              {(projects ?? [])
                .filter((p) => isStaff || p.joined)
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* Month grid */}
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="grid grid-cols-7 border-b border-border bg-muted/50">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="px-2 py-2 text-center text-xs font-medium text-muted-foreground"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d, i) => {
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday = sameDay(d, today);
              const isSel = sameDay(d, selected);
              const ds = slots.filter((s) => sameDay(new Date(s.starts_at), d));
              const mins = sessions
                .filter((s) => sameDay(new Date(s.check_in_at), d) && s.status !== "rejected")
                .reduce((a, s) => a + (s.duration_minutes ?? 0), 0);
              return (
                <button
                  key={i}
                  onClick={() => setSelected(d)}
                  aria-label={d.toDateString()}
                  aria-pressed={isSel}
                  className={cn(
                    "flex min-h-20 flex-col gap-1 border-b border-r border-border p-1.5 text-left align-top transition-colors sm:min-h-28 sm:p-2",
                    i % 7 === 6 && "border-r-0",
                    i >= 35 && "border-b-0",
                    !inMonth && "bg-muted/30 text-muted-foreground",
                    isSel ? "bg-accent/8 ring-2 ring-inset ring-accent" : "hover:bg-secondary/60",
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span
                      className={cn(
                        "tnum flex size-6 items-center justify-center rounded-full text-xs",
                        isToday && "bg-primary font-semibold text-primary-foreground",
                      )}
                    >
                      {d.getDate()}
                    </span>
                    {mins > 0 && (
                      <span
                        className="tnum hidden text-[10px] text-success sm:inline"
                        title={`${formatMinutes(mins)} logged`}
                      >
                        {formatMinutes(mins)}
                      </span>
                    )}
                  </span>
                  {ds.slice(0, 3).map((s) => (
                    <span
                      key={s.id}
                      title={`${hm(s.starts_at)} ${s.title}`}
                      className={cn(
                        "hidden truncate rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight sm:block",
                        KIND[s.kind]?.chip,
                      )}
                    >
                      {s.title}
                    </span>
                  ))}
                  {ds.length > 0 && (
                    <span className="flex gap-0.5 sm:hidden">
                      {ds.slice(0, 4).map((s) => (
                        <span
                          key={s.id}
                          className={cn("size-1.5 rounded-full", KIND[s.kind]?.bar)}
                        />
                      ))}
                    </span>
                  )}
                  {ds.length > 3 && (
                    <span className="hidden text-[10px] text-muted-foreground sm:block">
                      +{ds.length - 3} more
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {isLoading && <p className="p-3 text-xs text-muted-foreground">Loading…</p>}
        </div>

        {/* Day + upcoming */}
        <aside className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-base">
              {selected.toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </h2>
            {daySlots.length === 0 && daySessions.length === 0 && (
              <p className="mt-2 text-sm text-muted-foreground">Nothing scheduled or logged.</p>
            )}
            <ul className="mt-3 space-y-3">
              {daySlots.map((s) => (
                <li key={s.id} className="flex gap-3">
                  <span
                    className={cn("mt-1 w-1 shrink-0 self-stretch rounded-full", KIND[s.kind]?.bar)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{s.title}</p>
                    <p className="tnum text-xs text-muted-foreground">
                      {hm(s.starts_at)}–{hm(s.ends_at)}, {KIND[s.kind]?.label}
                    </p>
                    <p className="text-xs text-muted-foreground">{s.projects?.title}</p>
                    {s.location && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" /> {s.location}
                      </p>
                    )}
                    {s.notes && <p className="mt-1 font-serif text-sm">{s.notes}</p>}
                    {canManage(s.project_id) && (
                      <div className="mt-1 flex gap-3">
                        <button
                          className="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
                          onClick={() =>
                            removeSlot.mutate({ id: s.id, series_id: s.series_id, all: false })
                          }
                        >
                          <Trash2 className="size-3" /> Remove
                        </button>
                        {s.series_id && (
                          <button
                            className="text-xs text-destructive hover:underline"
                            onClick={() =>
                              removeSlot.mutate({ id: s.id, series_id: s.series_id, all: true })
                            }
                          >
                            Remove whole series
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
              {daySessions.length > 0 && (
                <li className="border-t border-border pt-3 text-xs text-muted-foreground">
                  {daySessions.length} session{daySessions.length === 1 ? "" : "s"} logged,{" "}
                  {formatMinutes(daySessions.reduce((a, s) => a + (s.duration_minutes ?? 0), 0))}
                  {isStaff ? " across students" : ""}
                </li>
              )}
            </ul>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-base">Coming up</h2>
            {upcomingShown.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing scheduled ahead.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {upcomingShown.map((s) => (
                  <li key={s.id} className="py-2.5 first:pt-0 last:pb-0">
                    <button
                      className="w-full text-left"
                      onClick={() => {
                        const d = new Date(s.starts_at);
                        setSelected(d);
                        setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
                      }}
                    >
                      <p className="tnum text-xs text-muted-foreground">
                        {new Date(s.starts_at).toLocaleDateString(undefined, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                        , {hm(s.starts_at)}
                      </p>
                      <p className="text-sm font-medium">{s.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.projects?.title}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {isStaff && (
        <ScheduleDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          projects={manageable}
          defaultDate={selected}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["calendar"] });
            qc.invalidateQueries({ queryKey: ["calendar-upcoming"] });
          }}
        />
      )}
    </div>
  );
}

function ScheduleDialog({
  open,
  onOpenChange,
  projects,
  defaultDate,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projects: { id: string; title: string }[];
  defaultDate: Date;
  onDone: () => void;
}) {
  const { data: labs } = useLabs();
  const [f, setF] = useState({
    project_id: "",
    title: "",
    kind: "lab_session",
    date: "",
    start: "10:00",
    end: "12:00",
    location: "",
    lab_id: "none",
    repeat: "1",
    notes: "",
  });
  const date = f.date || toDateInput(defaultDate);

  const save = useMutation({
    mutationFn: async () => {
      if (!f.project_id) throw new Error("Choose an event");
      if (!f.title.trim()) throw new Error("Give it a title");
      const start = new Date(`${date}T${f.start}`);
      const end = new Date(`${date}T${f.kind === "deadline" ? f.start : f.end}`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
        throw new Error("Check the date and times");
      if (end < start) throw new Error("End time is before start time");
      const n = Math.min(Math.max(parseInt(f.repeat, 10) || 1, 1), 26);
      const series = n > 1 ? crypto.randomUUID() : null;
      const lab = (labs ?? []).find((l) => l.id === f.lab_id);
      const rows = Array.from({ length: n }, (_, i) => {
        const s = new Date(start);
        const e = new Date(end);
        s.setDate(s.getDate() + i * 7);
        e.setDate(e.getDate() + i * 7);
        return {
          project_id: f.project_id,
          title: f.title.trim(),
          kind: f.kind,
          starts_at: s.toISOString(),
          ends_at: e.toISOString(),
          location: f.location.trim() || lab?.location || lab?.name || null,
          lab_id: lab?.id ?? null,
          notes: f.notes.trim() || null,
          series_id: series,
        };
      });
      const { error } = await supabase.from("schedule_slots").insert(rows);
      if (error) throw error;
      return n;
    },
    onSuccess: (n) => {
      toast.success(n > 1 ? `Scheduled ${n} weekly slots` : "Scheduled");
      onOpenChange(false);
      setF({ ...f, title: "", notes: "", repeat: "1" });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add to schedule</DialogTitle>
          <DialogDescription>Members of the event get a notification.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-2">
              <Label>Event</Label>
              <Select value={f.project_id} onValueChange={(v) => setF({ ...f, project_id: v })}>
                <SelectTrigger aria-label="Event">
                  <SelectValue placeholder="Choose an event" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-2 sm:col-span-1">
              <Label htmlFor="slot-title">Title</Label>
              <Input
                id="slot-title"
                placeholder="e.g. Weekly lab hours"
                value={f.title}
                onChange={(e) => setF({ ...f, title: e.target.value })}
                maxLength={120}
              />
            </div>
            <div className="col-span-2 space-y-2 sm:col-span-1">
              <Label>Type</Label>
              <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })}>
                <SelectTrigger aria-label="Type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(KIND).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="slot-date">Date</Label>
              <Input
                id="slot-date"
                type="date"
                value={date}
                onChange={(e) => setF({ ...f, date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slot-repeat">Repeat weekly</Label>
              <Select value={f.repeat} onValueChange={(v) => setF({ ...f, repeat: v })}>
                <SelectTrigger id="slot-repeat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["1", "4", "8", "12", "16"].map((n) => (
                    <SelectItem key={n} value={n}>
                      {n === "1" ? "Once" : `${n} weeks`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="slot-start">{f.kind === "deadline" ? "Due at" : "Starts"}</Label>
              <Input
                id="slot-start"
                type="time"
                value={f.start}
                onChange={(e) => setF({ ...f, start: e.target.value })}
              />
            </div>
            {f.kind !== "deadline" && (
              <div className="space-y-2">
                <Label htmlFor="slot-end">Ends</Label>
                <Input
                  id="slot-end"
                  type="time"
                  value={f.end}
                  onChange={(e) => setF({ ...f, end: e.target.value })}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Lab</Label>
              <Select value={f.lab_id} onValueChange={(v) => setF({ ...f, lab_id: v })}>
                <SelectTrigger aria-label="Lab">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No lab</SelectItem>
                  {(labs ?? []).map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="slot-loc">Room</Label>
              <Input
                id="slot-loc"
                placeholder="e.g. Block B, 204"
                value={f.location}
                onChange={(e) => setF({ ...f, location: e.target.value })}
                maxLength={120}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="slot-notes">Notes</Label>
            <Textarea
              id="slot-notes"
              rows={2}
              placeholder="What to prepare, what's due"
              value={f.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
              maxLength={1000}
            />
          </div>
          <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending}>
            {f.repeat === "1" ? "Add to schedule" : `Add ${f.repeat} weekly slots`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
