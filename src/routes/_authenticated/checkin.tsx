import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, MapPin, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { assertCheckedIn, checkInFlagHint, getPosition, positionArgs } from "@/lib/presence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Search = { p?: string; c?: string };

export const Route = createFileRoute("/_authenticated/checkin")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    p: typeof s.p === "string" ? s.p : undefined,
    c: typeof s.c === "string" ? s.c.replace(/\D/g, "").slice(0, 6) : undefined,
  }),
  head: () => ({ meta: [{ title: "Check in — RAVS" }] }),
  component: CheckIn,
});

function CheckIn() {
  const { p: projectId, c: code } = Route.useSearch();
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [notes, setNotes] = useState("");
  // Prefilled from the QR link, but editable: the QR code often expires while
  // the student signs in, so they can type the one on screen instead.
  const [labCode, setLabCode] = useState(code ?? "");

  const { data, isLoading } = useQuery({
    queryKey: ["checkin-context", projectId, user?.id],
    enabled: !!user && !!projectId,
    queryFn: async () => {
      const [{ data: project }, { data: member }, { data: active }] = await Promise.all([
        supabase.from("projects").select("id, title, status").eq("id", projectId!).maybeSingle(),
        supabase
          .from("project_members")
          .select("project_id")
          .eq("project_id", projectId!)
          .eq("student_id", user!.id)
          .maybeSingle(),
        supabase
          .from("work_sessions")
          .select("id, project_id, projects(title)")
          .eq("student_id", user!.id)
          .eq("status", "active")
          .maybeSingle(),
      ]);
      return { project, isMember: !!member, active };
    },
  });

  const checkIn = useMutation({
    mutationFn: async () => {
      const pos = await getPosition();
      const { data: row, error } = await supabase.rpc("check_in", {
        p_project: projectId!,
        p_code: labCode || null,
        p_notes: notes.trim() || null,
        ...positionArgs(pos),
      });
      if (error) throw error;
      return assertCheckedIn(row);
    },
    onSuccess: (row) => {
      const flags = row?.flags ?? [];
      if (flags.length === 0) toast.success("Checked in — presence verified");
      else
        toast.warning("Checked in, but flagged for review", {
          description: checkInFlagHint(flags),
        });
      qc.invalidateQueries();
      navigate({ to: "/dashboard", replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto max-w-md space-y-5 rounded-xl border border-border bg-card p-6">
      {children}
    </div>
  );

  if (!projectId) {
    return shell(
      <>
        <h1 className="text-2xl">Check in</h1>
        <p className="text-sm text-muted-foreground">
          This link is missing the event. Scan the QR code on the lab screen again, or check in from
          your dashboard with the 6-digit code.
        </p>
        <Button asChild variant="outline">
          <Link to="/dashboard">Go to dashboard</Link>
        </Button>
      </>,
    );
  }

  if (role && role !== "student") {
    return shell(
      <>
        <h1 className="text-2xl">Check in</h1>
        <p className="text-sm text-muted-foreground">
          Only students check in. You're signed in as {role}.
        </p>
      </>,
    );
  }

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (!data.project) {
    return shell(
      <>
        <h1 className="text-2xl">Event not found</h1>
        <Button asChild variant="outline">
          <Link to="/projects">Browse events</Link>
        </Button>
      </>,
    );
  }

  if (data.active) {
    return shell(
      <>
        <h1 className="text-2xl">You're already checked in</h1>
        <p className="text-sm text-muted-foreground">
          Your session on{" "}
          <span className="font-medium text-foreground">{data.active.projects?.title}</span> is
          still running. Check out of it from your dashboard first.
        </p>
        <Button asChild>
          <Link to="/dashboard">Open dashboard</Link>
        </Button>
      </>,
    );
  }

  if (!data.isMember) {
    return shell(
      <>
        <h1 className="text-2xl">{data.project.title}</h1>
        <p className="text-sm text-muted-foreground">
          You aren't a member of this event yet. Join it, then scan the code again.
        </p>
        <Button asChild>
          <Link to="/projects/$id" params={{ id: data.project.id }}>
            Open event
          </Link>
        </Button>
      </>,
    );
  }

  return shell(
    <>
      <div>
        <p className="text-sm text-muted-foreground">Check in to</p>
        <h1 className="mt-1 text-2xl">{data.project.title}</h1>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ci-code" className="flex items-center gap-2">
          <KeyRound className="size-4" /> Lab code
        </Label>
        <Input
          id="ci-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="6-digit code on the lab screen"
          maxLength={6}
          value={labCode}
          onChange={(e) => setLabCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="tnum w-56 tracking-[0.3em]"
        />
        <p className="text-xs text-muted-foreground">
          {labCode
            ? "Codes change every 30 seconds. If this one has expired, type the code on the screen now."
            : "Without a lab code the session will be flagged for your supervisor."}
        </p>
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="size-4" /> Your location is checked against the lab
      </p>
      <div className="space-y-2">
        <Label htmlFor="ci-notes">Plan for this session (optional)</Label>
        <Textarea
          id="ci-notes"
          rows={2}
          maxLength={500}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <Button className="h-11 w-full" onClick={() => checkIn.mutate()} disabled={checkIn.isPending}>
        <Play className="size-4" /> {checkIn.isPending ? "Checking in…" : "Check in now"}
      </Button>
    </>,
  );
}
