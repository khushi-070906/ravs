import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ClipboardCheck, Timer, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RAVS — Research Attendance & Verification System" },
      {
        name: "description",
        content:
          "Replace paper research registers: students check in and submit work, faculty verify sessions, attendance is generated automatically.",
      },
      { property: "og:title", content: "RAVS — Research Attendance & Verification System" },
      {
        property: "og:description",
        content:
          "Digital check-in, faculty-verified work sessions and automatic attendance recommendations for college research labs.",
      },
    ],
  }),
  component: Landing,
});

const features = [
  {
    icon: Timer,
    title: "Check in, check out",
    body: "A live timer runs while a student works in the lab. One open session at a time, timestamped automatically.",
  },
  {
    icon: ClipboardCheck,
    title: "Verified work",
    body: "Every session ends with a written summary that goes to the supervising faculty for approval or rejection with remarks.",
  },
  {
    icon: ShieldCheck,
    title: "Attendance that holds up",
    body: "Only approved hours count. Percentages and eligibility are computed from verified sessions, not memory.",
  },
];

function Landing() {
  const { session, loading } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="font-display text-lg font-semibold">RAVS</span>
        <Button asChild variant="ghost" size="sm">
          <Link to={session ? "/dashboard" : "/auth"}>
            {loading ? "…" : session ? "Open dashboard" : "Sign in"}
          </Link>
        </Button>
      </header>

      <section className="mx-auto max-w-3xl px-6 pb-16 pt-14 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Research Attendance &amp; Verification
        </p>
        <h1 className="mt-5 text-balance text-4xl leading-tight sm:text-5xl">
          The lab register, finally worth trusting
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-pretty text-muted-foreground">
          Students log real work sessions. Faculty verify them. Attendance is what remains after
          verification — no registers, no reconstructed spreadsheets at semester end.
        </p>
        <div className="mt-8">
          <Button asChild size="lg">
            <Link to={session ? "/dashboard" : "/auth"}>
              {session ? "Go to dashboard" : "Get started"}
            </Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-6 px-6 pb-24 sm:grid-cols-3">
        {features.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-lg border border-border bg-card p-6">
            <Icon className="size-5 text-accent" />
            <h2 className="mt-4 text-lg">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
