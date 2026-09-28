import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { currentUser } from "@/lib/current-user";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const user = await currentUser();
    if (!user) {
      // remember where they were going (e.g. a scanned check-in QR)
      try {
        sessionStorage.setItem("ravs.next", location.href);
      } catch {
        /* storage unavailable */
      }
      throw redirect({ to: "/auth" });
    }
    return { user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
