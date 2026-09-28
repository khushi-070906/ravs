import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Radio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatDistance } from "@/lib/presence";
import { formatMinutes, elapsedMinutes } from "@/lib/session-utils";
import { FlagBadges } from "@/components/presence-flags";

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

export function LiveRoster({
  projectId,
  title = "In the lab now",
}: {
  projectId?: string;
  title?: string;
}) {
  const { data, isLoading } = useLiveSessions(projectId);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const rows = data ?? [];

  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-2 text-base">
          {rows.length > 0 && (
            <span className="pulse-dot size-2 rounded-full bg-accent" aria-hidden />
          )}
          {title}
        </h2>
        <span className="tnum text-xs text-muted-foreground">{rows.length}</span>
      </div>
      {isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Radio className="size-4" /> Nobody is checked in.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {rows.map((r) => {
            const dist = formatDistance(r.check_in_distance_m);
            return (
              <li key={r.session_id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{r.student_name}</span>
                  <span className="tnum shrink-0 text-xs text-muted-foreground">
                    {formatMinutes(elapsedMinutes(r.check_in_at))}
                  </span>
                </div>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
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
                  <span>
                    since{" "}
                    {new Date(r.check_in_at).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </p>
                <FlagBadges flags={r.flags} className="mt-1" />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
