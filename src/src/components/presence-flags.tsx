import { AlertTriangle, KeyRound, MapPin } from "lucide-react";
import { FLAG_INFO, flagLabel, formatDistance } from "@/lib/presence";
import { cn } from "@/lib/utils";

export function FlagBadges({ flags, className }: { flags: string[] | null; className?: string }) {
  if (!flags || flags.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Review flags">
      {flags.map((f) => (
        <li
          key={f}
          title={FLAG_INFO[f]?.detail}
          className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning-foreground"
        >
          <AlertTriangle className="size-3" />
          {flagLabel(f)}
        </li>
      ))}
    </ul>
  );
}

type PresenceRow = {
  check_in_method: string;
  check_in_distance_m: number | null;
  check_out_distance_m: number | null;
  check_in_lat: number | null;
  check_out_lat: number | null;
};

/** One-line evidence summary: how they checked in and how far from the lab. */
export function PresenceLine({ s }: { s: PresenceRow }) {
  const inD = formatDistance(s.check_in_distance_m);
  const outD = formatDistance(s.check_out_distance_m);
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <KeyRound className="size-3" />
        {s.check_in_method === "code" ? "Lab code" : "No code"}
      </span>
      {(inD || outD) && (
        <span className="inline-flex items-center gap-1">
          <MapPin className="size-3" />
          {[inD && `in ${inD}`, outD && `out ${outD}`].filter(Boolean).join(", ")} from lab
        </span>
      )}
      {!inD && !outD && (s.check_in_lat != null || s.check_out_lat != null) && (
        <span className="inline-flex items-center gap-1">
          <MapPin className="size-3" /> Location recorded (lab has no geofence)
        </span>
      )}
    </p>
  );
}
