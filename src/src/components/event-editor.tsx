import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useDepartments, useLabs, useStaff } from "@/lib/institution";
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

type Project = Database["public"]["Tables"]["projects"]["Row"];
const NONE = "none";

export function EventEditor({
  project,
  open,
  onOpenChange,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data: departments } = useDepartments();
  const { data: labs } = useLabs();
  const { data: staff } = useStaff();

  const init = () => ({
    title: project.title,
    description: project.description ?? "",
    objectives: project.objectives ?? "",
    status: project.status as string,
    department_id: project.department_id ?? NONE,
    lab_id: project.lab_id ?? NONE,
    domain: project.domain ?? "",
    keywords: (project.keywords ?? []).join(", "),
    funding_source: project.funding_source ?? "",
    co_supervisor_id: project.co_supervisor_id ?? NONE,
    start_date: project.start_date ?? "",
    end_date: project.end_date ?? "",
    required_hours: String(project.required_hours ?? 60),
    max_members: project.max_members ? String(project.max_members) : "",
  });
  const [f, setF] = useState(init);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open) setF(init());
  }, [open, project.id]);

  const set = (k: keyof ReturnType<typeof init>) => (v: string) => setF({ ...f, [k]: v });

  const save = useMutation({
    mutationFn: async () => {
      if (!f.title.trim()) throw new Error("Title is required");
      const hours = Number(f.required_hours);
      if (!Number.isFinite(hours) || hours < 0) throw new Error("Required hours must be 0 or more");
      const cap = f.max_members ? parseInt(f.max_members, 10) : null;
      if (cap !== null && !(cap > 0)) throw new Error("Member limit must be positive");
      if (f.start_date && f.end_date && f.end_date < f.start_date)
        throw new Error("End date is before start date");
      const lab = (labs ?? []).find((l) => l.id === f.lab_id);
      const { error } = await supabase
        .from("projects")
        .update({
          title: f.title.trim(),
          description: f.description.trim() || null,
          objectives: f.objectives.trim() || null,
          status: f.status as Project["status"],
          department_id: f.department_id === NONE ? null : f.department_id,
          lab_id: lab?.id ?? null,
          lab_name: lab?.name ?? project.lab_name,
          domain: f.domain.trim() || null,
          keywords: f.keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean)
            .slice(0, 12),
          funding_source: f.funding_source.trim() || null,
          co_supervisor_id: f.co_supervisor_id === NONE ? null : f.co_supervisor_id,
          start_date: f.start_date || null,
          end_date: f.end_date || null,
          required_hours: hours,
          max_members: cap,
        })
        .eq("id", project.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Event updated");
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["recommendations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pick = (
    key: "department_id" | "lab_id" | "co_supervisor_id" | "status",
    label: string,
    options: { id: string; name: string }[],
    noneLabel?: string,
  ) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={f[key]} onValueChange={set(key)}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const text = (
    key: keyof ReturnType<typeof init>,
    label: string,
    props: Record<string, unknown> = {},
  ) => (
    <div className="space-y-2">
      <Label htmlFor={`ev-${key}`}>{label}</Label>
      <Input
        id={`ev-${key}`}
        value={f[key]}
        onChange={(e) => set(key)(e.target.value)}
        {...props}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit event</DialogTitle>
          <DialogDescription>
            Details students see, and the rules used for attendance.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <section className="space-y-4">
            {text("title", "Title", { maxLength: 140 })}
            <div className="space-y-2">
              <Label htmlFor="ev-description">Research question or description</Label>
              <Textarea
                id="ev-description"
                rows={3}
                value={f.description}
                onChange={(e) => set("description")(e.target.value)}
                maxLength={2000}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ev-objectives">Objectives</Label>
              <Textarea
                id="ev-objectives"
                rows={3}
                placeholder="One per line"
                value={f.objectives}
                onChange={(e) => set("objectives")(e.target.value)}
                maxLength={2000}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {text("domain", "Research area", { placeholder: "e.g. Computer vision" })}
              {text("keywords", "Keywords", { placeholder: "comma, separated" })}
            </div>
          </section>

          <section className="grid gap-4 border-t border-border pt-6 sm:grid-cols-2">
            {pick(
              "department_id",
              "Department",
              (departments ?? []).map((d) => ({ id: d.id, name: d.name })),
              "None",
            )}
            {pick(
              "lab_id",
              "Lab",
              (labs ?? []).map((l) => ({ id: l.id, name: l.name })),
              "None",
            )}
            {pick(
              "co_supervisor_id",
              "Co-supervisor",
              (staff ?? []).filter((s) => s.id !== project.faculty_id),
              "None",
            )}
            {text("funding_source", "Funding", { placeholder: "e.g. DST, internal" })}
          </section>

          <section className="grid gap-4 border-t border-border pt-6 sm:grid-cols-2">
            {text("start_date", "Starts", { type: "date" })}
            {text("end_date", "Ends", { type: "date" })}
            {text("required_hours", "Required hours per student", { type: "number", min: 0 })}
            {text("max_members", "Member limit", {
              type: "number",
              min: 1,
              placeholder: "No limit",
            })}
            {pick("status", "Status", [
              { id: "active", name: "Active" },
              { id: "completed", name: "Completed" },
              { id: "archived", name: "Archived" },
            ])}
          </section>

          <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending}>
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
