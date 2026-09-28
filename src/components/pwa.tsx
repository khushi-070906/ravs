import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { toast } from "sonner";
import { Download, Share, WifiOff } from "lucide-react";
import { useInstall, useOnline } from "@/lib/pwa";
import { cn } from "@/lib/utils";

const HOUR = 60 * 60 * 1000;

/**
 * Registers the service worker. When a new version is deployed it asks before
 * reloading, so nobody loses a half-typed summary. Lab screens stay open for
 * hours, so it also checks for updates hourly.
 */
export function PwaUpdater() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => {
        if (navigator.onLine) void registration.update();
      }, HOUR);
    },
  });

  useEffect(() => {
    if (!needRefresh) return;
    toast("A new version of RAVS is available", {
      id: "pwa-update",
      duration: Infinity,
      action: { label: "Reload", onClick: () => void updateServiceWorker(true) },
    });
  }, [needRefresh, updateServiceWorker]);

  return null;
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-foreground px-4 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-center text-xs font-medium text-background"
    >
      <WifiOff className="size-3.5 shrink-0" />
      You're offline. Check-in, check-out and reviews need a connection.
    </div>
  );
}

/** "Install app" control; renders nothing when installed or not installable. */
export function InstallButton({
  variant = "light",
  className,
}: {
  variant?: "light" | "dark" | "icon";
  className?: string;
}) {
  const { mode, install } = useInstall();
  if (!mode) return null;

  async function onClick() {
    if (mode === "ios") {
      toast("Install RAVS on your iPhone or iPad", {
        description: "In Safari, tap Share, then “Add to Home Screen”.",
        icon: <Share className="size-4" />,
        duration: 8000,
      });
      return;
    }
    const ok = await install();
    if (ok) toast.success("RAVS installed");
  }

  if (variant === "icon") {
    return (
      <button
        onClick={onClick}
        aria-label="Install app"
        className={cn("rounded-md p-2 text-muted-foreground hover:bg-secondary", className)}
      >
        <Download className="size-4" />
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        variant === "dark"
          ? "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        className,
      )}
    >
      <Download className="size-4" />
      Install app
    </button>
  );
}
