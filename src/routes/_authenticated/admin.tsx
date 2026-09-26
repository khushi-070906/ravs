import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Plus, Search, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useDepartments, useInstitution, useLabs, useStaff } from "@/lib/institution";
import { PageHeader, downloadCsv } from "@/components/research";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — RAVS" }] }),
  component: AdminPage,
});

const NONE = "none";
const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

function AdminPage() {
  const { role } = useAuth();
  if (role === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (role !== "admin")
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
        Only administrators can open the admin console.
      </div>
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin"
        intro="People, departments, labs and institution settings. Every change here is written to the audit log."
      />
      <Tabs defaultValue="users">
        <TabsList className="flex h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="labs">Labs</TabsTrigger>
          <TabsTrigger value="institution">Institution</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-6">
          <UsersTab />
        </TabsContent>
        <TabsContent value="departments" className="mt-6">
          <DepartmentsTab />
        </TabsContent>
        <TabsContent value="labs" className="mt-6">
          <LabsTab />
        </TabsContent>
        <TabsContent value="institution" className="mt-6">
          <InstitutionTab />
        </TabsContent>
        <TabsContent value="audit" className="mt-6">
          <AuditTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------- users */

function UsersTab() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: departments } = useDepartments();
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");

  const { data: users, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_users");
      if (error) throw error;
      return data ?? [];
    },
  });

  const setRole = useMutation({
    mutationFn: async (v: { id: string; role: "student" | "faculty" | "admin" }) => {
      const { error } = await supabase.rpc("admin_update_user_role", {
        target_user_id: v.id,
        new_role: v.role,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Role updated. They need to sign in again through the new portal.");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDept = useMutation({
    mutationFn: async (v: { id: string; department_id: string | null }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ department_id: v.department_id })
        .eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (users ?? []).filter(
      (u) =>
        (roleFilter === "all" || u.role === roleFilter) &&
        (deptFilter === "all" ||
          (deptFilter === NONE ? !u.department_id : u.department_id === deptFilter)) &&
        (!s ||
          [u.full_name, u.email, u.college_id].some((x) => (x ?? "").toLowerCase().includes(s))),
    );
  }, [users, q, roleFilter, deptFilter]);

  const counts = (r: string) => (users ?? []).filter((u) => u.role === r).length;

  return (
    <div className="grid gap-8 2xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search users"
              placeholder="Name, email or ID"
              className="pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-9 w-40" aria-label="Filter by role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles ({(users ?? []).length})</SelectItem>
              <SelectItem value="student">Students ({counts("student")})</SelectItem>
              <SelectItem value="faculty">Faculty ({counts("faculty")})</SelectItem>
              <SelectItem value="admin">Admins ({counts("admin")})</SelectItem>
            </SelectContent>
          </Select>
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="h-9 w-48" aria-label="Filter by department">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              <SelectItem value={NONE}>No department</SelectItem>
              {(departments ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv("ravs-users.csv", [
                ["Name", "Email", "College ID", "Role", "Department", "Joined", "Last sign-in"],
                ...rows.map((u) => [
                  u.full_name,
                  u.email,
                  u.college_id,
                  u.role,
                  departments?.find((d) => d.id === u.department_id)?.name ?? "",
                  fmtDate(u.created_at),
                  fmtDate(u.last_sign_in_at),
                ]),
              ])
            }
          >
            <Download className="size-4" /> CSV
          </Button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Person</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 font-medium">Last sign-in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {rows.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium">
                      {u.full_name || "Unnamed"}
                      {u.id === user?.id && (
                        <span className="font-normal text-muted-foreground"> (you)</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {u.email}
                      {u.college_id && `, ${u.college_id}`}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={u.role}
                      onValueChange={(v) =>
                        setRole.mutate({ id: u.id, role: v as "student" | "faculty" | "admin" })
                      }
                      disabled={setRole.isPending}
                    >
                      <SelectTrigger className="h-8 w-28" aria-label={`Role for ${u.full_name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="student">Student</SelectItem>
                        <SelectItem value="faculty">Faculty</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={u.department_id ?? NONE}
                      onValueChange={(v) =>
                        setDept.mutate({ id: u.id, department_id: v === NONE ? null : v })
                      }
                    >
                      <SelectTrigger
                        className="h-8 w-44"
                        aria-label={`Department for ${u.full_name}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>None</SelectItem>
                        {(departments ?? []).map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="tnum whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {fmtDate(u.created_at)}
                  </td>
                  <td className="tnum whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {fmtDate(u.last_sign_in_at)}
                  </td>
                </tr>
              ))}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    No users match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <FacultyAllowlist />
    </div>
  );
}

function FacultyAllowlist() {
  const [email, setEmail] = useState("");
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["faculty-allowlist"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_faculty_allowlist", {});
      if (error) throw error;
      return (data ?? []) as string[];
    },
  });
  const change = useMutation({
    mutationFn: async (v: { add?: string; remove?: string }) => {
      const { error } = await supabase.rpc("admin_faculty_allowlist", {
        ...(v.add ? { add_email: v.add } : {}),
        ...(v.remove ? { remove_email: v.remove } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["faculty-allowlist"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <aside className="h-fit max-w-xl space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-base">Faculty allowlist</h2>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Emails here become faculty when they sign up. Everyone else starts as a student. For
        existing accounts, change the role in the table.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) change.mutate({ add: email.trim() });
        }}
      >
        <Input
          type="email"
          aria-label="Faculty email"
          placeholder="prof@college.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" size="icon" aria-label="Add" disabled={change.isPending}>
          <Plus className="size-4" />
        </Button>
      </form>
      <ul className="divide-y divide-border text-sm">
        {(data ?? []).map((e) => (
          <li key={e} className="flex items-center justify-between gap-2 py-2">
            <span className="truncate">{e}</span>
            <button
              aria-label={`Remove ${e}`}
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
              onClick={() => change.mutate({ remove: e })}
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
        {(data ?? []).length === 0 && (
          <li className="py-2 text-xs text-muted-foreground">No emails yet.</li>
        )}
      </ul>
    </aside>
  );
}

/* ------------------------------------------------------------- departments */

function DepartmentsTab() {
  const qc = useQueryClient();
  const { data: departments } = useDepartments();
  const { data: labs } = useLabs();
  const { data: staff } = useStaff();
  const [form, setForm] = useState({ name: "", code: "" });

  const { data: projectCounts } = useQuery({
    queryKey: ["dept-project-counts"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("department_id");
      const m = new Map<string, number>();
      (data ?? []).forEach(
        (p) => p.department_id && m.set(p.department_id, (m.get(p.department_id) ?? 0) + 1),
      );
      return m;
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["departments"] });
  const add = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Department name is required");
      const { error } = await supabase
        .from("departments")
        .insert({ name: form.name.trim(), code: form.code.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm({ name: "", code: "" });
      refresh();
      toast.success("Department added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async (v: {
      id: string;
      patch: { name?: string; code?: string | null; head_id?: string | null };
    }) => {
      const { error } = await supabase.from("departments").update(v.patch).eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("departments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("Department removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <div className="min-w-56 flex-1 space-y-2">
          <Label htmlFor="dept-name">Department name</Label>
          <Input
            id="dept-name"
            placeholder="e.g. Information Technology"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="w-32 space-y-2">
          <Label htmlFor="dept-code">Code</Label>
          <Input
            id="dept-code"
            placeholder="IT"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
        </div>
        <Button type="submit" disabled={add.isPending}>
          <Plus className="size-4" /> Add
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Head</th>
              <th className="px-4 py-3 text-right font-medium">Labs</th>
              <th className="px-4 py-3 text-right font-medium">Events</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(departments ?? []).map((d) => (
              <tr key={d.id}>
                <td className="px-4 py-2">
                  <InlineText
                    value={d.name}
                    label="Department name"
                    onSave={(v) => v && update.mutate({ id: d.id, patch: { name: v } })}
                  />
                </td>
                <td className="w-28 px-4 py-2">
                  <InlineText
                    value={d.code ?? ""}
                    label="Code"
                    onSave={(v) => update.mutate({ id: d.id, patch: { code: v || null } })}
                  />
                </td>
                <td className="px-4 py-2">
                  <Select
                    value={d.head_id ?? NONE}
                    onValueChange={(v) =>
                      update.mutate({ id: d.id, patch: { head_id: v === NONE ? null : v } })
                    }
                  >
                    <SelectTrigger className="h-8 w-48" aria-label={`Head of ${d.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Not set</SelectItem>
                      {(staff ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="tnum px-4 py-2 text-right">
                  {(labs ?? []).filter((l) => l.department_id === d.id).length}
                </td>
                <td className="tnum px-4 py-2 text-right">{projectCounts?.get(d.id) ?? 0}</td>
                <td className="px-4 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${d.name}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (
                        confirm(
                          `Delete ${d.name}? Labs, people and events keep existing without a department.`,
                        )
                      )
                        remove.mutate(d.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {(departments ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No departments yet. Add your first one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InlineText({
  value,
  label,
  onSave,
}: {
  value: string;
  label: string;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Input
      aria-label={label}
      className="h-8 border-transparent bg-transparent px-2 shadow-none hover:border-input focus-visible:border-input"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== value && onSave(v.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

/* -------------------------------------------------------------------- labs */

function LabsTab() {
  const qc = useQueryClient();
  const { data: labs } = useLabs();
  const { data: departments } = useDepartments();
  const { data: staff } = useStaff();
  const empty = { name: "", department_id: NONE, location: "", capacity: "" };
  const [form, setForm] = useState(empty);
  const refresh = () => qc.invalidateQueries({ queryKey: ["labs"] });

  const add = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Lab name is required");
      const cap = form.capacity ? parseInt(form.capacity, 10) : null;
      const { error } = await supabase.from("labs").insert({
        name: form.name.trim(),
        department_id: form.department_id === NONE ? null : form.department_id,
        location: form.location.trim() || null,
        capacity: cap && cap > 0 ? cap : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm(empty);
      refresh();
      toast.success("Lab added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async (v: {
      id: string;
      patch: {
        name?: string;
        department_id?: string | null;
        location?: string | null;
        incharge_id?: string | null;
        capacity?: number | null;
      };
    }) => {
      const { error } = await supabase.from("labs").update(v.patch).eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("labs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <form
        className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1.5fr_1.5fr_100px_auto] lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="lab-name">Lab name</Label>
          <Input
            id="lab-name"
            placeholder="e.g. AI & Vision Lab"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
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
              <SelectItem value={NONE}>None</SelectItem>
              {(departments ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="lab-loc">Location</Label>
          <Input
            id="lab-loc"
            placeholder="Block B, 204"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lab-cap">Seats</Label>
          <Input
            id="lab-cap"
            type="number"
            min={1}
            value={form.capacity}
            onChange={(e) => setForm({ ...form, capacity: e.target.value })}
          />
        </div>
        <Button type="submit" disabled={add.isPending}>
          <Plus className="size-4" /> Add lab
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">Lab</th>
              <th className="px-4 py-3 font-medium">Department</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">In charge</th>
              <th className="px-4 py-3 font-medium">Seats</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(labs ?? []).map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2">
                  <InlineText
                    value={l.name}
                    label="Lab name"
                    onSave={(v) => v && update.mutate({ id: l.id, patch: { name: v } })}
                  />
                </td>
                <td className="px-4 py-2">
                  <Select
                    value={l.department_id ?? NONE}
                    onValueChange={(v) =>
                      update.mutate({ id: l.id, patch: { department_id: v === NONE ? null : v } })
                    }
                  >
                    <SelectTrigger className="h-8 w-44" aria-label={`Department of ${l.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {(departments ?? []).map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-2">
                  <InlineText
                    value={l.location ?? ""}
                    label="Location"
                    onSave={(v) => update.mutate({ id: l.id, patch: { location: v || null } })}
                  />
                </td>
                <td className="px-4 py-2">
                  <Select
                    value={l.incharge_id ?? NONE}
                    onValueChange={(v) =>
                      update.mutate({ id: l.id, patch: { incharge_id: v === NONE ? null : v } })
                    }
                  >
                    <SelectTrigger className="h-8 w-44" aria-label={`In charge of ${l.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Not set</SelectItem>
                      {(staff ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="w-24 px-4 py-2">
                  <InlineText
                    value={l.capacity ? String(l.capacity) : ""}
                    label="Seats"
                    onSave={(v) => {
                      const n = parseInt(v, 10);
                      update.mutate({ id: l.id, patch: { capacity: n > 0 ? n : null } });
                    }}
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${l.name}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => confirm(`Delete ${l.name}?`) && remove.mutate(l.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {(labs ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No labs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- institution */

function InstitutionTab() {
  const qc = useQueryClient();
  const { data } = useInstitution();
  const [f, setF] = useState({
    name: "",
    short_name: "",
    academic_year: "",
    semester_label: "",
    semester_start: "",
    semester_end: "",
    min_attendance_pct: "75",
    timezone: "Asia/Kolkata",
  });
  useEffect(() => {
    if (data)
      setF({
        name: data.name ?? "",
        short_name: data.short_name ?? "",
        academic_year: data.academic_year ?? "",
        semester_label: data.semester_label ?? "",
        semester_start: data.semester_start ?? "",
        semester_end: data.semester_end ?? "",
        min_attendance_pct: String(data.min_attendance_pct ?? 75),
        timezone: data.timezone ?? "Asia/Kolkata",
      });
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const pct = parseInt(f.min_attendance_pct, 10);
      if (!f.name.trim()) throw new Error("Institution name is required");
      if (!(pct >= 0 && pct <= 100)) throw new Error("Minimum attendance must be 0–100");
      if (f.semester_start && f.semester_end && f.semester_end < f.semester_start)
        throw new Error("Semester ends before it starts");
      const { error } = await supabase
        .from("institution_settings")
        .update({
          name: f.name.trim(),
          short_name: f.short_name.trim() || null,
          academic_year: f.academic_year.trim() || null,
          semester_label: f.semester_label.trim() || null,
          semester_start: f.semester_start || null,
          semester_end: f.semester_end || null,
          min_attendance_pct: pct,
          timezone: f.timezone.trim() || "Asia/Kolkata",
        })
        .eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["institution"] });
      qc.invalidateQueries({ queryKey: ["recommendations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const field = (key: keyof typeof f, label: string, props: Record<string, unknown> = {}) => (
    <div className="space-y-2">
      <Label htmlFor={`inst-${key}`}>{label}</Label>
      <Input
        id={`inst-${key}`}
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
        {...props}
      />
    </div>
  );

  return (
    <div className="max-w-2xl space-y-6 rounded-lg border border-border bg-card p-6">
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">{field("name", "Institution name")}</div>
        {field("short_name", "Short name", { placeholder: "e.g. GTBIT" })}
        {field("timezone", "Time zone", { placeholder: "Asia/Kolkata" })}
      </section>
      <section className="space-y-4 border-t border-border pt-6">
        <div>
          <h2 className="text-base">Current term</h2>
          <p className="text-xs text-muted-foreground">
            Used to pace attendance recommendations when an event has no start and end date.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("academic_year", "Academic year", { placeholder: "2026–27" })}
          {field("semester_label", "Semester", { placeholder: "Odd semester" })}
          {field("semester_start", "Starts", { type: "date" })}
          {field("semester_end", "Ends", { type: "date" })}
        </div>
      </section>
      <section className="space-y-4 border-t border-border pt-6">
        <div>
          <h2 className="text-base">Attendance rule</h2>
          <p className="text-xs text-muted-foreground">
            A student is eligible for an event once verified hours reach this share of its required
            hours.
          </p>
        </div>
        <div className="w-40">
          {field("min_attendance_pct", "Minimum (%)", { type: "number", min: 0, max: 100 })}
        </div>
      </section>
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        Save settings
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------- audit */

const ACTION_LABEL: Record<string, string> = {
  check_in: "Checked in",
  check_out: "Checked out",
  verify: "Verified session",
  return: "Returned session",
  role_change: "Changed role",
  join: "Joined event",
  leave: "Left event",
  insert: "Created",
  update: "Updated",
  delete: "Deleted",
};

function AuditTab() {
  const [entity, setEntity] = useState("all");
  const [limit, setLimit] = useState(100);
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["audit", entity, limit],
    queryFn: async () => {
      let query = supabase
        .from("audit_log")
        .select("*")
        .order("at", { ascending: false })
        .limit(limit);
      if (entity !== "all") query = query.eq("entity", entity);
      const { data, error } = await query;
      if (error) throw error;
      const ids = [
        ...new Set(
          (data ?? []).flatMap((r) => {
            const d = (r.details ?? {}) as Record<string, unknown>;
            return [r.actor_id, d.student_id as string | undefined].filter(Boolean) as string[];
          }),
        ),
      ];
      const { data: people } = ids.length
        ? await supabase.from("profiles").select("id, full_name").in("id", ids)
        : { data: [] as { id: string; full_name: string }[] };
      return { rows: data ?? [], names: new Map((people ?? []).map((p) => [p.id, p.full_name])) };
    },
  });

  const describe = (r: NonNullable<typeof data>["rows"][number]) => {
    const d = (r.details ?? {}) as Record<string, unknown>;
    const parts: string[] = [];
    if (d.name) parts.push(String(d.name));
    if (d.student_id && d.student_id !== r.actor_id)
      parts.push(data?.names.get(String(d.student_id)) ?? "student");
    if (d.from !== undefined || d.to) parts.push(`${d.from ?? "none"} → ${d.to}`);
    if (typeof d.minutes === "number" && d.minutes > 0) parts.push(`${d.minutes} min`);
    if (d.file) parts.push(String(d.file));
    if (Array.isArray(d.changed) && d.changed.length) parts.push(`changed ${d.changed.join(", ")}`);
    if (d.remarks) parts.push(`“${d.remarks}”`);
    return parts.join(", ");
  };

  const rows = (data?.rows ?? []).filter((r) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [data?.names.get(r.actor_id ?? ""), r.action, r.entity, describe(r)]
      .filter(Boolean)
      .some((x) => String(x).toLowerCase().includes(s));
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search audit log"
            placeholder="Person, action or detail"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={entity} onValueChange={setEntity}>
          <SelectTrigger className="h-9 w-48" aria-label="Filter by record type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All records</SelectItem>
            <SelectItem value="work_sessions">Sessions</SelectItem>
            <SelectItem value="user_roles">Roles</SelectItem>
            <SelectItem value="projects">Events</SelectItem>
            <SelectItem value="project_members">Membership</SelectItem>
            <SelectItem value="submissions">Files</SelectItem>
            <SelectItem value="schedule_slots">Schedule</SelectItem>
            <SelectItem value="departments">Departments</SelectItem>
            <SelectItem value="labs">Labs</SelectItem>
            <SelectItem value="institution_settings">Settings</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={rows.length === 0}
          onClick={() =>
            downloadCsv("ravs-audit-log.csv", [
              ["Time", "Actor", "Action", "Record", "Record ID", "Details"],
              ...rows.map((r) => [
                new Date(r.at).toISOString(),
                data?.names.get(r.actor_id ?? "") ?? (r.actor_id ? r.actor_id : "system"),
                r.action,
                r.entity,
                r.entity_id,
                JSON.stringify(r.details),
              ]),
            ])
          }
        >
          <Download className="size-4" /> CSV
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Who</th>
              <th className="px-4 py-3 font-medium">What</th>
              <th className="px-4 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="tnum whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                  {new Date(r.at).toLocaleString(undefined, {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  {r.actor_id ? (data?.names.get(r.actor_id) ?? "Unknown user") : "System"}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  {ACTION_LABEL[r.action] ?? r.action}
                  <span className="text-muted-foreground"> · {r.entity.replace(/_/g, " ")}</span>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{describe(r)}</td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No activity recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(data?.rows.length ?? 0) >= limit && (
        <Button variant="outline" onClick={() => setLimit(limit + 200)}>
          Load older entries
        </Button>
      )}
    </div>
  );
}
