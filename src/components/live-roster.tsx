import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCheck, KeyRound, Radio, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatDistance } from "@/lib/presence";
import { formatMinutes, elapsedMinutes } from "@/lib/session-utils";
import { FlagBadges } from "@/components/presence-flags";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Who is checked in right now. Polls; staff or the event's supervisors only. */
export function useLiveSessions(projectId?: string, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["live-sessions", projectId ?? "all", user?.id],
    enabled: !!user && enabled,
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("live_sessions", {
        p_project: projectId ?? null,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export function LiveRoster({
  projectId,
  canConfirm,
  title = "In the lab now",
}: {
  projectId?: string;
  /** Show "Present" buttons. Defaults to faculty; pass true for event supervisors. */
  canConfirm?: boolean;
  title?: string;
}) {
  const { role } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useLiveSessions(projectId);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const confirmer = canConfirm ?? role === "faculty";
  const rows = data ?? [];
  const unconfirmed = rows.filter((r) => !r.present_confirmed_at).length;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["live-sessions"] });
    qc.invalidateQueries({ queryKey: ["approval-queue"] });
  };

  const confirm = useMutation({
    mutationFn: async ({ id, present }: { id: string; present: boolean }) => {
      const { error } = await supabase.rpc("confirm_presence", {
        p_session: id,
        p_present: present,
      });
      if (error) throw error;
      return present;
    },
    onSuccess: (present) => {
      if (!present) toast("Confirmation removed");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmAll = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("confirm_presence_all", {
        p_project: projectId!,
      });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: (n) => {
      toast.success(`${n} ${n === 1 ? "student" : "students"} confirmed present`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base">
          {rows.length > 0 && (
            <span className="pulse-dot size-2 rounded-full bg-accent" aria-hidden />
          )}
          {title}
        </h2>
        <span className="tnum text-xs text-muted-foreground">
          {rows.length > 0 && confirmer
            ? `${rows.length - unconfirmed}/${rows.length} confirmed`
            : rows.length}
        </span>
      </div>

      {isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Radio className="size-4" /> Nobody is checked in.
        </p>
      ) : (
        <>
          {confirmer && projectId && unconfirmed > 1 && (
            <Button
              size="sm"
              variant="outline"
              className="mt-3 w-full"
              onClick={() => confirmAll.mutate()}
              disabled={confirmAll.isPending}
            >
              <CheckCheck className="size-4" /> Everyone here is present ({unconfirmed})
            </Button>
          )}
          <ul className="mt-3 divide-y divide-border">
            {rows.map((r) => {
              const dist = formatDistance(r.check_in_distance_m);
              const confirmed = !!r.present_confirmed_at;
              return (
                <li key={r.session_id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">{r.student_name}</span>
                    {confirmer ? (
                      <button
                        onClick={() => confirm.mutate({ id: r.session_id, present: !confirmed })}
                        disabled={confirm.isPending}
                        title={confirmed ? "Tap to undo" : "Confirm you can see this student"}
                        aria-pressed={confirmed}
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                          confirmed
                            ? "border-success/40 bg-success/12 text-success"
                            : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                        )}
                      >
                        <UserCheck className="size-3.5" />
                        {confirmed ? "Present" : "Mark present"}
                      </button>
                    ) : (
                      confirmed && <ConfirmedBadge compact />
                    )}
                  </div>
                  <p className="tnum flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>
                      {formatMinutes(elapsedMinutes(r.check_in_at))} · since {hhmm(r.check_in_at)}
                    </span>
                    {!projectId && (
                      <Link
                        to="/projects/$id"
                        params={{ id: r.project_id }}
                        className="truncate hover:underline"
                      >
                        {r.project_title}
                      </Link>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <KeyRound className="size-3" />
                      {r.check_in_method === "code" ? "code" : "no code"}
                      {dist && `, ${dist} away`}
                    </span>
                  </p>
                  {confirmed && r.present_confirmed_at && (
                    <p className="text-[11px] text-success">
                      Confirmed{" "}
                      {r.present_confirmed_by_name ? `by ${r.present_confirmed_by_name} ` : ""}
                      at {hhmm(r.present_confirmed_at)}
                    </p>
                  )}
                  <FlagBadges flags={r.flags} className="mt-1" />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

/** Green "supervisor confirmed" evidence badge. */
export function ConfirmedBadge({
  at,
  by,
  compact,
  className,
}: {
  at?: string | null;
  by?: string | null;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      title={at ? `Confirmed present${by ? ` by ${by}` : ""} at ${hhmm(at)}` : undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/12 px-2 py-0.5 text-[11px] font-medium text-success",
        className,
      )}
    >
      <UserCheck className="size-3" />
      {compact
        ? "Present"
        : `Supervisor confirmed${by ? ` · ${by}` : ""}${at ? ` · ${hhmm(at)}` : ""}`}
    </span>
  );
}
