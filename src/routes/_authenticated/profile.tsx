import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActivityGrid, MetricStrip, PageHeader } from "@/components/research";
import { hoursFrom } from "@/lib/session-utils";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile — RAVS" },
      { name: "description", content: "Your RAVS account details and department information." },
      { property: "og:title", content: "Profile — RAVS" },
      { property: "og:description", content: "Manage your RAVS account details." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, role, profile } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState({ full_name: "", college_id: "" });

  useEffect(() => {
    if (profile) {
      setForm({
        full_name: profile.full_name ?? "",
        college_id: profile.college_id ?? "",
      });
    }
  }, [profile]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.full_name.trim()) throw new Error("Name can't be empty");
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: form.full_name.trim(),
          college_id: form.college_id.trim() || null,
        })
        .eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profile updated");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: record } = useQuery({
    queryKey: ["research-record", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [{ data: sessions }, { count: joined }, { count: supervised }] = await Promise.all([
        supabase
          .from("work_sessions")
          .select("check_in_at, duration_minutes, status")
          .eq("student_id", user!.id),
        supabase
          .from("project_members")
          .select("id", { count: "exact", head: true })
          .eq("student_id", user!.id),
        supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          .eq("faculty_id", user!.id),
      ]);
      return { sessions: sessions ?? [], joined: joined ?? 0, supervised: supervised ?? 0 };
    },
  });
  const isStaff = role === "faculty" || role === "admin";
  const verifiedMins = (record?.sessions ?? [])
    .filter((s) => s.status === "approved")
    .reduce((a, s) => a + (s.duration_minutes ?? 0), 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Profile"
        intro={
          <>
            Signed in as {user?.email}, <span className="capitalize">{role ?? "member"}</span>.
          </>
        }
      />

      <MetricStrip
        items={
          isStaff
            ? [
                { label: "Events supervised", value: String(record?.supervised ?? 0) },
                { label: "Role", value: role === "admin" ? "Admin" : "Faculty" },
                {
                  label: "Member since",
                  value: user?.created_at
                    ? new Date(user.created_at).getFullYear().toString()
                    : "—",
                },
              ]
            : [
                { label: "Verified hours", value: `${hoursFrom(verifiedMins)}h` },
                { label: "Events joined", value: String(record?.joined ?? 0) },
                { label: "Sessions logged", value: String((record?.sessions ?? []).length) },
              ]
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <h2 className="text-xl">Details</h2>
          <div className="space-y-4 rounded-lg border border-border bg-card p-6">
            <div className="space-y-2">
              <Label htmlFor="full_name">Full name</Label>
              <Input
                id="full_name"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="college_id">College or roll number</Label>
              <Input
                id="college_id"
                placeholder="e.g. 2024IT102"
                value={form.college_id}
                onChange={(e) => setForm({ ...form, college_id: e.target.value })}
                maxLength={100}
              />
            </div>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              Save changes
            </Button>
          </div>
        </div>
        {!isStaff && (
          <div className="space-y-4">
            <h2 className="text-xl">Research record</h2>
            <ActivityGrid sessions={record?.sessions ?? []} weeks={18} />
          </div>
        )}
      </div>
    </div>
  );
}
