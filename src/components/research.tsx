import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { formatMinutes, hoursFrom } from "@/lib/session-utils";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  approved: { label: "Verified", cls: "text-success", dot: "bg-success" },
  pending: { label: "Awaiting review", cls: "text-warning-foreground", dot: "bg-warning" },
  rejected: { label: "Returned", cls: "text-destructive", dot: "bg-destructive" },
  active: { label: "In progress", cls: "text-accent", dot: "bg-accent" },
  completed: { label: "Completed", cls: "text-muted-foreground", dot: "bg-muted-foreground" },
  archived: { label: "Archived", cls: "text-muted-foreground", dot: "bg-border" },
};

const EVENT_LABEL: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};

export function StatusBadge({
  status,
  className,
  kind = "session",
}: {
  status: string;
  className?: string;
  kind?: "session" | "event";
}) {
  const base = STATUS[status] ?? { label: status, cls: "text-muted-foreground", dot: "bg-border" };
  const s = kind === "event" ? { ...base, label: EVENT_LABEL[status] ?? base.label } : base;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", s.cls, className)}>
      <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Page header                                                                */
/* -------------------------------------------------------------------------- */

export function PageHeader({
  title,
  intro,
  actions,
}: {
  title: string;
  intro?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
      <div className="max-w-2xl">
        <h1 className="text-3xl">{title}</h1>
        {intro && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{intro}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Metric strip — one panel, divided, instead of a row of identical cards     */
/* -------------------------------------------------------------------------- */

export function MetricStrip({
  items,
}: {
  items: { label: string; value: string; hint?: string }[];
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border",
        items.length === 3 ? "sm:grid-cols-3" : "lg:grid-cols-4",
      )}
    >
      {items.map((m) => (
        <div key={m.label} className="bg-card p-4 sm:p-5">
          <dt className="text-sm text-muted-foreground">{m.label}</dt>
          <dd className="tnum mt-1.5 font-display text-2xl font-semibold sm:text-3xl">{m.value}</dd>
          {m.hint && <dd className="mt-0.5 text-xs text-muted-foreground">{m.hint}</dd>}
        </div>
      ))}
      {items.length === 3 && <div className="bg-card sm:hidden" aria-hidden />}
    </dl>
  );
}

/* -------------------------------------------------------------------------- */
/* Hours progress against an event's requirement                              */
/* -------------------------------------------------------------------------- */

export function HoursProgress({
  approvedMins,
  pendingMins = 0,
  requiredHours,
  compact,
}: {
  approvedMins: number;
  pendingMins?: number;
  requiredHours: number | null | undefined;
  compact?: boolean;
}) {
  const req = requiredHours && requiredHours > 0 ? requiredHours : null;
  const approvedH = hoursFrom(approvedMins);
  const total = req ? req * 60 : Math.max(approvedMins + pendingMins, 1);
  const a = Math.min(100, (approvedMins / total) * 100);
  const p = Math.min(100 - a, (pendingMins / total) * 100);
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="tnum font-medium text-foreground">
          {approvedH}h{req ? ` of ${req}h` : ""} verified
        </span>
        {!compact && req && (
          <span className="tnum text-muted-foreground">
            {Math.round((approvedMins / (req * 60)) * 100)}%
          </span>
        )}
      </div>
      <div
        className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-secondary"
        role="img"
        aria-label={`${approvedH} hours verified${req ? ` of ${req} required` : ""}`}
      >
        <span className="h-full bg-success" style={{ width: `${a}%` }} />
        <span className="h-full bg-warning/70" style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Activity grid — verified minutes per day                                   */
/* -------------------------------------------------------------------------- */

type ActivitySession = { check_in_at: string; duration_minutes: number | null; status: string };

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function ActivityGrid({
  sessions,
  weeks = 18,
  title = "Verified research time",
}: {
  sessions: ActivitySession[];
  weeks?: number;
  title?: string;
}) {
  const byDay = new Map<string, number>();
  for (const s of sessions) {
    if (s.status !== "approved") continue;
    const k = dayKey(new Date(s.check_in_at));
    byDay.set(k, (byDay.get(k) ?? 0) + (s.duration_minutes ?? 0));
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - ((end.getDay() + 6) % 7))); // Sunday of this week
  const start = new Date(end);
  start.setDate(start.getDate() - weeks * 7 + 1);

  const cols: { date: Date; mins: number }[][] = [];
  const cur = new Date(start);
  let total = 0;
  let activeDays = 0;
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const mins = byDay.get(dayKey(cur)) ?? 0;
      if (cur <= today) {
        total += mins;
        if (mins > 0) activeDays++;
      }
      col.push({ date: new Date(cur), mins: cur <= today ? mins : -1 });
      cur.setDate(cur.getDate() + 1);
    }
    cols.push(col);
  }

  const level = (m: number) =>
    m < 0
      ? "bg-transparent"
      : m === 0
        ? "bg-secondary"
        : m < 60
          ? "bg-success/30"
          : m < 120
            ? "bg-success/55"
            : m < 240
              ? "bg-success/80"
              : "bg-success";

  const months: { label: string; col: number }[] = [];
  cols.forEach((c, i) => {
    const first = c[0].date;
    const prev = months[months.length - 1];
    const changed = i === 0 || first.getMonth() !== cols[i - 1][0].date.getMonth();
    // skip a label that would collide with the previous one
    if (changed && (!prev || i - prev.col >= 3))
      months.push({ label: first.toLocaleString(undefined, { month: "short" }), col: i });
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base">{title}</h2>
        <p className="tnum text-xs text-muted-foreground">
          {hoursFrom(total)}h over {activeDays} day{activeDays === 1 ? "" : "s"}, last {weeks} weeks
        </p>
      </div>
      <div className="mt-4 overflow-x-auto">
        <div
          className="inline-grid gap-y-1"
          style={{ gridTemplateColumns: `20px repeat(${weeks}, 14px)`, columnGap: 3 }}
        >
          <span />
          {cols.map((_, i) => {
            const m = months.find((x) => x.col === i);
            return (
              <span
                key={i}
                className="h-4 overflow-visible whitespace-nowrap text-[10px] leading-4 text-muted-foreground"
              >
                {m?.label ?? ""}
              </span>
            );
          })}
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <div key={d} className="contents">
              <span className="text-[10px] leading-[14px] text-muted-foreground">
                {d === 0 ? "Mon" : d === 2 ? "Wed" : d === 4 ? "Fri" : ""}
              </span>
              {cols.map((c, i) => (
                <span
                  key={i}
                  title={
                    c[d].mins >= 0
                      ? `${c[d].date.toDateString()}: ${formatMinutes(c[d].mins)} verified`
                      : undefined
                  }
                  className={cn("size-[14px] rounded-[3px]", level(c[d].mins))}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        Less
        {["bg-secondary", "bg-success/30", "bg-success/55", "bg-success/80", "bg-success"].map(
          (c) => (
            <span key={c} className={cn("size-2.5 rounded-[2px]", c)} />
          ),
        )}
        More
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Research log — sessions as dated lab-notebook entries                      */
/* -------------------------------------------------------------------------- */

export type LogSession = {
  id: string;
  status: string;
  check_in_at: string;
  check_out_at?: string | null;
  duration_minutes: number | null;
  summary?: string | null;
  remarks?: string | null;
  project_id?: string;
  projects?: { title: string } | null;
  student_name?: string;
  student_college_id?: string | null;
};

const timeFmt: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

export function ResearchLog({
  sessions,
  empty,
  showStudent,
  showEvent = true,
  renderActions,
}: {
  sessions: LogSession[];
  empty: ReactNode;
  showStudent?: boolean;
  showEvent?: boolean;
  renderActions?: (s: LogSession) => ReactNode;
}) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    );
  }

  const groups: { label: string; items: LogSession[] }[] = [];
  for (const s of sessions) {
    const label = new Date(s.check_in_at).toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(s);
    else groups.push({ label, items: [s] });
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.label}>
          <h3 className="mb-2 font-sans text-xs font-medium text-muted-foreground">{g.label}</h3>
          <ol className="relative space-y-3 border-l border-border pl-5">
            {g.items.map((s) => {
              const start = new Date(s.check_in_at).toLocaleTimeString(undefined, timeFmt);
              const end = s.check_out_at
                ? new Date(s.check_out_at).toLocaleTimeString(undefined, timeFmt)
                : null;
              return (
                <li key={s.id} className="relative">
                  <span
                    className={cn(
                      "absolute -left-[25px] top-4 size-2.5 rounded-full border-2 border-background",
                      STATUS[s.status]?.dot ?? "bg-border",
                    )}
                    aria-hidden
                  />
                  <article className="rounded-lg border border-border bg-card p-4">
                    <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
                      <div className="min-w-0 flex-1">
                        {showStudent && s.student_name && (
                          <p className="text-sm font-medium">
                            {s.student_name}
                            {s.student_college_id && (
                              <span className="ml-2 font-normal text-muted-foreground">
                                {s.student_college_id}
                              </span>
                            )}
                          </p>
                        )}
                        {showEvent &&
                          (s.project_id ? (
                            <Link
                              to="/projects/$id"
                              params={{ id: s.project_id }}
                              className={cn(
                                "text-sm hover:underline",
                                showStudent ? "text-muted-foreground" : "font-medium",
                              )}
                            >
                              {s.projects?.title ?? "Event"}
                            </Link>
                          ) : (
                            <p className="text-sm font-medium">{s.projects?.title ?? "Event"}</p>
                          ))}
                        <p className="tnum mt-0.5 text-xs text-muted-foreground">
                          {start}
                          {end ? `–${end}` : ""}
                          {s.status !== "active" && `, ${formatMinutes(s.duration_minutes)}`}
                        </p>
                      </div>
                      <StatusBadge status={s.status} />
                    </header>
                    {s.summary && (
                      <p className="mt-3 whitespace-pre-line font-serif text-[15px] leading-relaxed text-foreground">
                        {s.summary}
                      </p>
                    )}
                    {s.remarks && (
                      <p className="mt-3 border-l-2 border-border pl-3 text-sm text-muted-foreground">
                        Reviewer: {s.remarks}
                      </p>
                    )}
                    {renderActions?.(s)}
                  </article>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Attendance recommendation badge                                            */
/* -------------------------------------------------------------------------- */

const REC: Record<string, { label: string; cls: string; dot: string }> = {
  eligible: { label: "Eligible", cls: "text-success", dot: "bg-success" },
  on_track: { label: "On track", cls: "text-accent", dot: "bg-accent" },
  at_risk: { label: "At risk", cls: "text-warning-foreground", dot: "bg-warning" },
  behind: { label: "Behind", cls: "text-destructive", dot: "bg-destructive" },
};

export function RecommendationBadge({ value, className }: { value: string; className?: string }) {
  const r = REC[value] ?? { label: value, cls: "text-muted-foreground", dot: "bg-border" };
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", r.cls, className)}
    >
      <span className={cn("size-2 rounded-sm", r.dot)} aria-hidden />
      {r.label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* CSV export                                                                 */
/* -------------------------------------------------------------------------- */

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
