import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { toast } from "sonner";
import { ArrowLeft, Expand, FlaskConical, RefreshCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { checkInUrl } from "@/lib/presence";
import { useLiveSessions } from "@/components/live-roster";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/presence/$id")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      try {
        sessionStorage.setItem("ravs.next", location.href);
      } catch {
        /* storage unavailable */
      }
      throw redirect({ to: "/auth" });
    }
  },
  head: () => ({ meta: [{ title: "Lab check-in code — RAVS" }] }),
  component: PresenceScreen,
});

function PresenceScreen() {
  const { id } = Route.useParams();
  const [now, setNow] = useState(Date.now());
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const { data: project } = useQuery({
    queryKey: ["presence-project", id],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("title").eq("id", id).maybeSingle();
      return data;
    },
  });

  const {
    data: current,
    error,
    refetch,
  } = useQuery({
    queryKey: ["presence-code", id],
    // A lab screen runs all day: ride out network blips instead of dying on
    // the first failed request. Permission errors are not worth retrying.
    retry: (n, e) => n < 5 && !/supervisors/i.test((e as Error).message),
    retryDelay: (n) => Math.min(1000 * 2 ** n, 10_000),
    refetchOnWindowFocus: true,
    // safety net in case a scheduled refresh is ever missed
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const sent = Date.now();
      const { data, error } = await supabase.rpc("presence_code", { p_project: id });
      if (error) throw error;
      const row = data?.[0];
      if (!row) return null;
      // Kiosk clocks drift. Measure the offset to the server clock (midpoint
      // of the round trip) so the countdown and refresh follow the server.
      const received = Date.now();
      const offset = row.server_now
        ? new Date(row.server_now).getTime() - (sent + received) / 2
        : 0;
      return { ...row, offset };
    },
  });

  const offset = current?.offset ?? 0;
  const expiresAt = current ? new Date(current.expires_at).getTime() : 0;
  const period = (current?.period_s ?? 30) * 1000;
  const left = Math.max(0, expiresAt - (now + offset));

  // fetch the next code the moment the current window ends (server time)
  useEffect(() => {
    if (!current) return;
    const wait = Math.max(0, expiresAt - (Date.now() + offset)) + 250;
    const t = setTimeout(() => void refetch(), wait);
    return () => clearTimeout(t);
  }, [current, expiresAt, offset, refetch]);

  useEffect(() => {
    if (!current?.code) return;
    QRCode.toDataURL(checkInUrl(id, current.code), {
      margin: 1,
      width: 720,
      errorCorrectionLevel: "M",
    }).then(setQr, () => setQr(null));
  }, [current?.code, id]);

  const { data: live } = useLiveSessions(id, !error);
  const liveCount = live?.length ?? 0;

  const rotate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("presence_rotate", { p_project: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Secret rotated. Every earlier code is now invalid.");
      void refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Only give up the screen when there's nothing to show (e.g. not a
  // supervisor). A failed refresh keeps the last code up with a warning.
  const stale = !!error && !!current && left === 0;

  if (error && !current) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">{(error as Error).message}</p>
        <Button asChild variant="outline">
          <Link to="/projects/$id" params={{ id }}>
            Back to event
          </Link>
        </Button>
      </div>
    );
  }

  const digits = current?.code ?? "······";

  return (
    <div className="flex min-h-screen flex-col bg-sidebar text-sidebar-foreground">
      <header className="flex items-center justify-between gap-3 px-6 py-4">
        <Link
          to="/projects/$id"
          params={{ id }}
          className="inline-flex items-center gap-1.5 text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground"
        >
          <ArrowLeft className="size-4" /> Event
        </Link>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={() => confirm("Invalidate all codes shown so far?") && rotate.mutate()}
            disabled={rotate.isPending}
          >
            <RefreshCcw className="size-4" /> Rotate secret
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
          >
            <Expand className="size-4" /> Full screen
          </Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-10 lg:flex-row lg:gap-16">
        <div className="rounded-2xl bg-white p-4 shadow-lg">
          {qr ? (
            <img
              src={qr}
              alt="Check-in QR code"
              className="size-[min(70vw,420px)] [image-rendering:pixelated]"
            />
          ) : (
            <div className="size-[min(70vw,420px)]" />
          )}
        </div>

        <div className="max-w-md text-center lg:text-left">
          <p className="flex items-center justify-center gap-2 text-sm text-sidebar-foreground/70 lg:justify-start">
            <FlaskConical className="size-4" /> Scan to check in
          </p>
          <h1 className="mt-2 font-display text-3xl leading-tight text-sidebar-primary">
            {project?.title ?? "Event"}
          </h1>
          <p className="mt-8 text-sm text-sidebar-foreground/70">Or enter this code</p>
          <p
            className="tnum mt-1 font-display text-7xl font-semibold tracking-[0.18em] text-sidebar-primary sm:text-8xl"
            aria-live="polite"
          >
            {digits.slice(0, 3)}
            <span className="inline-block w-4" />
            {digits.slice(3)}
          </p>
          <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-sidebar-accent">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-200 ease-linear"
              style={{ width: `${Math.min(100, (left / period) * 100)}%` }}
            />
          </div>
          <p className="tnum mt-6 text-sm text-sidebar-foreground/70" aria-live="polite">
            {liveCount === 0
              ? "Nobody checked in yet"
              : `${liveCount} ${liveCount === 1 ? "person" : "people"} checked in`}
          </p>
          <p className="tnum mt-2 text-xs text-sidebar-foreground/60">
            {stale
              ? "Reconnecting… this code may have expired"
              : `New code in ${Math.ceil(left / 1000)}s`}
          </p>
        </div>
      </main>
    </div>
  );
}
