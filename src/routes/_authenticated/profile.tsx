import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-3xl">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Signed in as {user?.email} · <span className="capitalize">{role ?? "member"}</span>
        </p>
      </div>

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
          <Label htmlFor="college_id">College</Label>
          <Input
            id="college_id"
            placeholder="College name"
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
  );
}
