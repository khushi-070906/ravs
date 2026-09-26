export function formatMinutes(mins: number | null | undefined) {
  const m = Math.max(0, Math.round(mins ?? 0));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

export function hoursFrom(mins: number | null | undefined) {
  return Math.round(((mins ?? 0) / 60) * 10) / 10;
}

export function elapsedMinutes(from: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 60000));
}

export function liveClock(from: string) {
  const total = Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function statusTone(status: string) {
  switch (status) {
    case "approved":
      return "bg-success/12 text-success border-success/30";
    case "rejected":
      return "bg-destructive/12 text-destructive border-destructive/30";
    case "pending":
      return "bg-warning/15 text-warning-foreground border-warning/40";
    default:
      return "bg-accent/15 text-accent border-accent/40";
  }
}

export function startOfWeek() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}
