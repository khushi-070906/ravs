export type Position = { lat: number; lng: number; accuracy: number };

/**
 * Best-effort device location. Resolves null when the user denies permission,
 * the browser has no geolocation, or it takes too long — check-in never waits
 * on this; the server just flags the session instead.
 */
export function getPosition(timeoutMs = 8000): Promise<Position | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = (v: Position | null) => resolve(v);
    const t = setTimeout(() => done(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(t);
        done({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      () => {
        clearTimeout(t);
        done(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

export function positionArgs(pos: Position | null) {
  return {
    p_lat: pos?.lat ?? null,
    p_lng: pos?.lng ?? null,
    p_accuracy: pos ? Math.round(pos.accuracy) : null,
  };
}

export const FLAG_INFO: Record<string, { label: string; detail: string }> = {
  no_code: {
    label: "No lab code",
    detail: "Checked in without the rotating code shown in the lab.",
  },
  off_site_in: {
    label: "Off-site check-in",
    detail: "Location at check-in was outside the lab's geofence.",
  },
  off_site_out: {
    label: "Off-site check-out",
    detail: "Location at check-out was outside the lab's geofence.",
  },
  no_location_in: {
    label: "No location (in)",
    detail: "Location was unavailable or denied at check-in.",
  },
  no_location_out: {
    label: "No location (out)",
    detail: "Location was unavailable or denied at check-out.",
  },
  low_accuracy_in: {
    label: "Weak GPS (in)",
    detail: "Near the lab, but the device reported poor location accuracy at check-in.",
  },
  low_accuracy_out: {
    label: "Weak GPS (out)",
    detail: "Near the lab, but the device reported poor location accuracy at check-out.",
  },
  time_corrected: {
    label: "Time corrected",
    detail: "Check-out time was changed after a correction the supervisor accepted.",
  },
  too_long: {
    label: "Capped",
    detail: "Session ran past the institution limit and was capped.",
  },
  auto_closed: {
    label: "Auto-closed",
    detail: "Student never checked out; closed automatically at the limit.",
  },
  manual_entry: {
    label: "Manual entry",
    detail: "Hours reported by the student without the timer",
  },
};

export function flagLabel(f: string) {
  return FLAG_INFO[f]?.label ?? f.replace(/_/g, " ");
}

export function formatDistance(m: number | null | undefined) {
  if (m == null) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function checkInUrl(projectId: string, code: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/checkin?p=${encodeURIComponent(projectId)}&c=${encodeURIComponent(code)}`;
}

/**
 * check_in() returns an empty row (instead of raising) for a wrong code, so the
 * server can record the failed attempt for throttling.
 */
export function assertCheckedIn<T extends { id: string | null } | null | undefined>(
  row: T,
): NonNullable<T> {
  if (!row || !row.id) {
    throw new Error(
      "That check-in code has expired or is for another event. Use the code on the lab screen now.",
    );
  }
  return row as NonNullable<T>;
}

/** Plain-language hint for the most important flag on a fresh check-in. */
export function checkInFlagHint(flags: string[]): string {
  if (flags.includes("no_code")) return "Enter the code shown in the lab next time.";
  if (flags.some((f) => f.startsWith("off_site"))) return "Your location didn't match the lab.";
  if (flags.some((f) => f.startsWith("no_location")))
    return "Location was unavailable. Allow location access for this site.";
  if (flags.some((f) => f.startsWith("low_accuracy")))
    return "Your device's location was too imprecise. Turn on precise location / Wi-Fi.";
  return flags.map(flagLabel).join(", ");
}
