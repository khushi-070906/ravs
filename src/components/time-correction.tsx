import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Clock3, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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

export type CorrectionFields = {
  id: string;
  status: string;
  check_in_at: string;
  check_out_at: string | null;
  correction_check_out_at: string | null;
  correction_reason: string | null;
  correction_status: string | null;
};

/** Value for <input type="datetime-local"> in the browser's local time. */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const clock = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const minsBetween = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);

export function canRequestCorrection(s: CorrectionFields) {
  return (s.status === "pending" || s.status === "rejected") && s.correction_status !== "pending";
}

/** Student: ask the supervisor to change a session's check-out time. */
export function FixTimeDialog({ session }: { session: CorrectionFields }) {
  const qc = useQueryClient();
  const { data: institution } = useInstitution();
  const maxMins = institution?.max_session_minutes ?? 480;
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState(() =>
    toLocalInput(session.check_out_at ?? new Date().toISOString()),
  );
  const [reason, setReason] = useState("");

  const minIso = new Date(new Date(session.check_in_at).getTime() + 60_000).toISOString();
  const maxIso = new Date(
    Math.min(Date.now(), new Date(session.check_in_at).getTime() + maxMins * 60_000),
  ).toISOString();
  const picked = when ? new Date(when).toISOString() : null;
  const newMins = picked ? minsBetween(session.check_in_at, picked) : null;

  const submit = useMutation({
    mutationFn: async () => {
      if (!picked) throw new Error("Pick the time you actually left");
      if (reason.trim().length < 5) throw new Error("Say briefly why the time is wrong");
      const { error } = await supabase.rpc("request_time_correction", {
        p_session: session.id,
        p_check_out_at: picked,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Correction sent to your supervisor");
      setOpen(false);
      setReason("");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
          <Clock3 className="size-3.5" /> Fix time
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Correct check-out time</DialogTitle>
          <DialogDescription>
            Checked in {clock(session.check_in_at)}
            {session.check_out_at && <>, recorded out {clock(session.check_out_at)}</>}. Your
            supervisor has to accept the change before the session can be verified.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fix-when">When did you actually leave?</Label>
            <Input
              id="fix-when"
              type="datetime-local"
              value={when}
              min={toLocalInput(minIso)}
              max={toLocalInput(maxIso)}
              onChange={(e) => setWhen(e.target.value)}
            />
            {newMins != null && newMins > 0 && (
              <p className="tnum text-xs text-muted-foreground">
                Session would count {formatMinutes(newMins)}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="fix-reason">Reason</Label>
            <Textarea
              id="fix-reason"
              rows={3}
              maxLength={500}
              placeholder="e.g. Forgot to check out when I left the lab at 5 pm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? "Sending…" : "Send to supervisor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Student-facing status line for a correction, with withdraw. */
export function CorrectionStatus({ session }: { session: CorrectionFields }) {
  const qc = useQueryClient();
  const withdraw = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("withdraw_time_correction", { p_session: session.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Correction withdrawn");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!session.correction_status || !session.correction_check_out_at) return null;
  const to = clock(session.correction_check_out_at);
  if (session.correction_status === "pending") {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        Correction to {to} awaiting supervisor.{" "}
        <button
          className="underline hover:text-foreground"
          onClick={() => withdraw.mutate()}
          disabled={withdraw.isPending}
        >
          Withdraw
        </button>
      </p>
    );
  }
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      Correction to {to} {session.correction_status === "accepted" ? "accepted" : "declined"}
    </p>
  );
}

/** Faculty: the correction block inside a review card. */
export function CorrectionReview({
  session,
  remark,
  canDecide,
}: {
  session: CorrectionFields & { duration_minutes: number | null };
  remark: string;
  canDecide: boolean;
}) {
  const qc = useQueryClient();
  const resolve = useMutation({
    mutationFn: async (accept: boolean) => {
      if (!accept && !remark.trim()) throw new Error("Add a remark saying why you're declining");
      const { error } = await supabase.rpc("resolve_time_correction", {
        p_session: session.id,
        p_accept: accept,
        p_remarks: remark.trim() || null,
      });
      if (error) throw error;
      return accept;
    },
    onSuccess: (accept) => {
      toast.success(accept ? "Correction accepted" : "Correction declined");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (session.correction_status !== "pending" || !session.correction_check_out_at) return null;
  const newMins = minsBetween(session.check_in_at, session.correction_check_out_at);

  return (
    <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <Clock3 className="size-4" /> Time correction requested
      </p>
      <p className="tnum mt-1 text-muted-foreground">
        Check-out {session.check_out_at ? clock(session.check_out_at) : "—"} →{" "}
        <span className="font-medium text-foreground">
          {clock(session.correction_check_out_at)}
        </span>{" "}
        ({formatMinutes(session.duration_minutes)} → {formatMinutes(newMins)})
      </p>
      {session.correction_reason && (
        <p className="mt-1 text-muted-foreground">“{session.correction_reason}”</p>
      )}
      {canDecide && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => resolve.mutate(true)} disabled={resolve.isPending}>
            <Check className="size-4" /> Accept time
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => resolve.mutate(false)}
            disabled={resolve.isPending}
          >
            <X className="size-4" /> Decline
          </Button>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Resolve this before verifying.</p>
    </div>
  );
}
