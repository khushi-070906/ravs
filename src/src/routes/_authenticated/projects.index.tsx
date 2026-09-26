import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search, Share2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { HoursProgress, PageHeader, StatusBadge } from "@/components/research";
import { cn } from "@/lib/utils";
import { useDepartments, useLabs } from "@/lib/institution";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({
    meta: [
      { title: "Events — RAVS" },
      { name: "description", content: "Research events, rosters and supervising faculty." },
      { property: "og:title", content: "Events — RAVS" },
      { property: "og:description", content: "Browse and join research events." },
    ],
  }),
  component: ProjectsPage,
});

type Filter = "all" | "mine" | "active" | "completed";

function ProjectsPage() {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const isFaculty = role === "faculty" || role === "admin";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const emptyForm = {
    title: "",
    description: "",
    lab_id: "none",
    department_id: "none",
    required_hours: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [dept, setDept] = useState("all");
  const { data: departments } = useDepartments();
  const { data: labs } = useLabs();

  const { data, isLoading } = useQuery({
    queryKey: ["projects", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [{ data: projects, error }, { data: sessions }] = await Promise.all([
        supabase
          .from("projects")
          .select("*, project_members(student_id)")
          .order("created_at", { ascending: false }),
        // RLS returns only the caller's own sessions for students, all for staff.
        supabase.from("work_sessions").select("project_id, status, duration_minutes"),
      ]);
      if (error) throw error;
      const facultyIds = [...new Set((projects ?? []).map((p) => p.faculty_id))];
      const { data: supervisors } = facultyIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", facultyIds)
        : { data: [] as { id: string; full_name: string }[] };
      return {
        projects: projects ?? [],
        sessions: sessions ?? [],
        supervisor: new Map((supervisors ?? []).map((s) => [s.id, s.full_name])),
      };
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!isFaculty) throw new Error("Only faculty can create events");
      if (!form.title.trim()) throw new Error("Give the event a title");
      const hours = form.required_hours ? Number(form.required_hours) : null;
      if (hours !== null && (!Number.isFinite(hours) || hours < 0))
        throw new Error("Required hours must be a positive number");
      const { error } = await supabase.from("projects").insert({
        title: form.title.trim(),
        description: form.description.trim() || null,
        lab_id: form.lab_id === "none" ? null : form.lab_id,
        lab_name: labs?.find((l) => l.id === form.lab_id)?.name ?? null,
        department_id: form.department_id === "none" ? null : form.department_id,
        ...(hours !== null ? { required_hours: hours } : {}),
        faculty_id: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setOpen(false);
      setForm(emptyForm);
      toast.success("Event created");
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleEnroll = useMutation({
    mutationFn: async ({ projectId, joined }: { projectId: string; joined: boolean }) => {
      if (joined) {
        const { error } = await supabase
          .from("project_members")
          .delete()
          .eq("project_id", projectId)
          .eq("student_id", user!.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("project_members")
          .insert({ project_id: projectId, student_id: user!.id });
        if (error) throw error;
      }
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries();
      toast.success(v.joined ? "Left event" : "Joined event");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.projects ?? []).filter((p) => {
      const joined = (p.project_members ?? []).some((m) => m.student_id === user?.id);
      const owns = p.faculty_id === user?.id;
      if (filter === "mine" && !(joined || owns)) return false;
      if (filter === "active" && p.status !== "active") return false;
      if (filter === "completed" && p.status === "active") return false;
      if (dept !== "all" && p.department_id !== dept) return false;
      if (!q) return true;
      return [
        p.title,
        p.description,
        p.lab_name,
        p.domain,
        ...(p.keywords ?? []),
        data?.supervisor.get(p.faculty_id),
      ]
        .filter(Boolean)
        .some((t) => String(t).toLowerCase().includes(q));
    });
  }, [data, query, filter, dept, user?.id]);

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "mine", label: isFaculty ? "Supervised by me" : "Joined" },
    { key: "active", label: "Active" },
    { key: "completed", label: "Closed" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Events"
        intro={
          isFaculty
            ? "Research events in the department, with their members and verified hours."
            : "Join an event to log research time against it. Each event sets the hours you need."
        }
        actions={
          isFaculty && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="size-4" /> New event
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New research event</DialogTitle>
                  <DialogDescription>
                    Students join it, log sessions against it, and you verify their time.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      maxLength={140}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Department</Label>
                      <Select
                        value={form.department_id}
                        onValueChange={(v) => setForm({ ...form, department_id: v })}
                      >
                        <SelectTrigger aria-label="Department">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {(departments ?? []).map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Lab</Label>
                      <Select
                        value={form.lab_id}
                        onValueChange={(v) => setForm({ ...form, lab_id: v })}
                      >
                        <SelectTrigger aria-label="Lab">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {(labs ?? [])
                            .filter(
                              (l) =>
                                form.department_id === "none" ||
                                !l.department_id ||
                                l.department_id === form.department_id,
                            )
                            .map((l) => (
                              <SelectItem key={l.id} value={l.id}>
                                {l.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hours">Required hours</Label>
                      <Input
                        id="hours"
                        type="number"
                        min={0}
                        inputMode="numeric"
                        placeholder="Per student (default 60)"
                        value={form.required_hours}
                        onChange={(e) => setForm({ ...form, required_hours: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="desc">Research question or description</Label>
                    <Textarea
                      id="desc"
                      rows={3}
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      maxLength={1000}
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => create.mutate()}
                    disabled={create.isPending}
                  >
                    Create event
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search events"
            placeholder="Search title, lab or supervisor"
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {(departments ?? []).length > 0 && (
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger className="h-9 w-48" aria-label="Filter by department">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {(departments ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter events">
          {filters.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm",
                filter === f.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading events…</p>}

      {!isLoading && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          {(data?.projects ?? []).length === 0
            ? isFaculty
              ? "No events yet. Create the first one to start collecting sessions."
              : "No events yet. Your faculty will create one for you to join."
            : "No events match this search."}
        </div>
      )}

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {rows.map((p) => {
          const members = p.project_members ?? [];
          const joined = members.some((m) => m.student_id === user?.id);
          const ps = (data?.sessions ?? []).filter((s) => s.project_id === p.id);
          const sum = (st: string) =>
            ps.filter((s) => s.status === st).reduce((a, s) => a + (s.duration_minutes ?? 0), 0);
          const supervisor = data?.supervisor.get(p.faculty_id);
          return (
            <li
              key={p.id}
              className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link
                    to="/projects/$id"
                    params={{ id: p.id }}
                    className="font-display text-lg font-semibold leading-snug hover:underline"
                  >
                    {p.title}
                  </Link>
                  <StatusBadge kind="event" status={p.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[
                    departments?.find((d) => d.id === p.department_id)?.code ??
                      departments?.find((d) => d.id === p.department_id)?.name,
                    labs?.find((l) => l.id === p.lab_id)?.name ?? p.lab_name,
                    supervisor && `Supervised by ${supervisor}`,
                    `${members.length} member${members.length === 1 ? "" : "s"}`,
                  ]
                    .filter(Boolean)
                    .join("  /  ")}
                </p>
                {p.description && (
                  <p className="mt-2 line-clamp-2 max-w-prose font-serif text-[15px] leading-relaxed text-foreground/85">
                    {p.description}
                  </p>
                )}
              </div>

              <div>
                {isFaculty || joined ? (
                  <HoursProgress
                    compact
                    approvedMins={sum("approved")}
                    pendingMins={sum("pending")}
                    requiredHours={
                      isFaculty
                        ? p.required_hours
                          ? p.required_hours * Math.max(members.length, 1)
                          : null
                        : p.required_hours
                    }
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {p.required_hours
                      ? `${p.required_hours}h required per student`
                      : "No hour requirement"}
                  </p>
                )}
              </div>

              <div className="flex gap-2 md:justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Copy link to ${p.title}`}
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/projects/${p.id}`);
                    toast.success("Event link copied");
                  }}
                >
                  <Share2 className="size-4" />
                </Button>
                {!isFaculty && p.status === "active" && (
                  <Button
                    size="sm"
                    variant={joined ? "outline" : "default"}
                    onClick={() => toggleEnroll.mutate({ projectId: p.id, joined })}
                    disabled={toggleEnroll.isPending}
                  >
                    {joined ? "Leave" : "Join"}
                  </Button>
                )}
                <Button asChild size="sm" variant="outline">
                  <Link to="/projects/$id" params={{ id: p.id }}>
                    Open
                  </Link>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
