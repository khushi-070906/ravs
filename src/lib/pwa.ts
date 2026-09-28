import { useEffect, useState, useSyncExternalStore } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Captured at module load: Chrome can fire this before React mounts.
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos() {
  if (typeof navigator === "undefined") return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * What installing looks like on this device:
 *  - "prompt": the browser offered an install prompt we can trigger
 *  - "ios":    Safari; the user has to use Share → Add to Home Screen
 *  - null:     already installed, or the browser can't install
 */
export function useInstall() {
  const canPrompt = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => deferred !== null,
    () => false,
  );
  const [standalone, setStandalone] = useState(isStandalone);

  useEffect(() => {
    const mq = window.matchMedia?.("(display-mode: standalone)");
    const on = () => setStandalone(isStandalone());
    mq?.addEventListener?.("change", on);
    return () => mq?.removeEventListener?.("change", on);
  }, []);

  const mode: "prompt" | "ios" | null = standalone
    ? null
    : canPrompt
      ? "prompt"
      : isIos()
        ? "ios"
        : null;

  async function install() {
    if (!deferred) return false;
    const ev = deferred;
    deferred = null;
    emit();
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    return outcome === "accepted";
  }

  return { mode, install };
}

export function useOnline() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}
