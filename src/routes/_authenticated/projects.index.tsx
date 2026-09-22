import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

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

function ProjectsPage() {
  const { user, role, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const isFaculty = role === "faculty" || role === "admin";
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
  });

  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, project_members(student_id)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error("Give the event a title");
      if (!isFaculty) {
        try {
          await supabase.rpc("self_grant_faculty");
        } catch {
          // ignore error if role self-grant fails
        }
        try {
          await refreshProfile();
        } catch {
          // ignore profile refresh error
        }
      }
      const { error } = await supabase.from("projects").insert({
        title: form.title.trim(),
        description: form.description || null,
        faculty_id: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setOpen(false);
      setForm({ title: "", description: "" });
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
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Roster updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">Events</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isFaculty
              ? "Events you supervise and everything running in the department."
              : "Join an event to start logging verified research work."}
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> New event
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create event</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {!isFaculty && (
                <p className="text-xs text-muted-foreground">
                  Creating an event makes you Faculty so you can supervise it.
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  maxLength={140}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Description</Label>
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
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading events…</p>}

      {projects && projects.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-8 text-sm text-muted-foreground">
          No events yet.{" "}
          {isFaculty ? "Create the first one." : "Create one or ask your faculty to."}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {(projects ?? []).map((p) => {
          const joined = (p.project_members ?? []).some((m) => m.student_id === user?.id);
          return (
            <div key={p.id} className="flex flex-col rounded-lg border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg leading-snug">{p.title}</h2>
                <span className="rounded-full border border-border px-2 py-0.5 text-xs capitalize text-muted-foreground">
                  {p.status}
                </span>
              </div>
              {p.description && (
                <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{p.description}</p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                {(p.project_members ?? []).length} student
                {(p.project_members ?? []).length === 1 ? "" : "s"}
              </p>
              <div className="mt-4 flex gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link to="/projects/$id" params={{ id: p.id }}>
                    Open
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const url = `${window.location.origin}/projects/${p.id}`;
                    navigator.clipboard.writeText(url);
                    toast.success("Event link copied to clipboard!");
                  }}
                >
                  Share
                </Button>
                {!isFaculty && (
                  <Button
                    size="sm"
                    variant={joined ? "ghost" : "default"}
                    onClick={() => toggleEnroll.mutate({ projectId: p.id, joined })}
                    disabled={toggleEnroll.isPending}
                  >
                    {joined ? "Leave" : "Join event"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
