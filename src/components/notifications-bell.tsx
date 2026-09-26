import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function ago(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function NotificationsBell({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["notifications", user?.id],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const unread = (data ?? []).filter((n) => !n.read_at);

  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={unread.length ? `${unread.length} unread notifications` : "Notifications"}
          className={cn(
            "relative rounded-md p-2",
            tone === "dark"
              ? "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-secondary",
          )}
        >
          <Bell className="size-4" />
          {unread.length > 0 && (
            <span className="tnum absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unread.length > 9 ? "9+" : unread.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-medium">Notifications</p>
          {unread.length > 0 && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => markRead.mutate(unread.map((n) => n.id))}
            >
              Mark all read
            </button>
          )}
        </div>
        <ul className="max-h-96 divide-y divide-border overflow-y-auto">
          {(data ?? []).length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nothing yet. Reviews, new schedules and role changes show up here.
            </li>
          )}
          {(data ?? []).map((n) => {
            const body = (
              <>
                <p className={cn("text-sm", !n.read_at && "font-medium")}>{n.title}</p>
                {n.body && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">{ago(n.created_at)}</p>
              </>
            );
            return (
              <li key={n.id} className={cn(!n.read_at && "bg-accent/5")}>
                {n.link ? (
                  <Link
                    to={n.link}
                    className="block px-4 py-3 hover:bg-secondary"
                    onClick={() => !n.read_at && markRead.mutate([n.id])}
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="px-4 py-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
