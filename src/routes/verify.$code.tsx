import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, FlaskConical, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/verify/$code")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Verify certificate — RAVS" }, { name: "robots", content: "noindex" }],
  }),
  component: Verify,
});

const d = (iso: string | null) =>
  iso
    ? new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

function Verify() {
  const { code } = Route.useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["verify", code],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("verify_certificate", { p_code: code });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const valid = data && !data.revoked_at;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg">
        <Link to="/" className="mb-8 flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <FlaskConical className="size-4" />
          </span>
          <span className="font-display text-lg font-semibold">RAVS</span>
        </Link>

        {isLoading && <p className="text-sm text-muted-foreground">Checking certificate…</p>}

        {!isLoading && (error || !data) && (
          <div className="rounded-xl border border-destructive/40 bg-card p-6">
            <XCircle className="size-8 text-destructive" />
            <h1 className="mt-3 font-display text-2xl">No certificate with this code</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Code <span className="font-mono">{code}</span> was not issued by this system. The
              document may be altered or the code mistyped.
            </p>
          </div>
        )}

        {data && (
          <div
            className={`rounded-xl border bg-card p-6 ${valid ? "border-success/40" : "border-destructive/40"}`}
          >
            {valid ? (
              <BadgeCheck className="size-8 text-success" />
            ) : (
              <XCircle className="size-8 text-destructive" />
            )}
            <h1 className="mt-3 font-display text-2xl">
              {valid ? "Valid certificate" : "This certificate was revoked"}
            </h1>
            {!valid && (
              <p className="mt-1 text-sm text-muted-foreground">
                Revoked {d(data.revoked_at)}
                {data.revoked_reason && `: ${data.revoked_reason}`}
              </p>
            )}
            <dl className="mt-6 space-y-3 text-sm">
              {(
                [
                  [
                    "Student",
                    `${data.student_name}${data.student_college_id ? ` (${data.student_college_id})` : ""}`,
                  ],
                  ["Event", data.project_title],
                  ["Institution", data.institution_name],
                  ["Term", data.term_label],
                  [
                    "Period",
                    [d(data.period_start), d(data.period_end)].filter(Boolean).join(" – ") || null,
                  ],
                  [
                    "Verified time",
                    `${Math.round((data.verified_minutes / 60) * 10) / 10}h across ${data.session_count} sessions`,
                  ],
                  ["Attendance", `${data.progress_pct}% of ${data.required_hours}h required`],
                  ["Issued by", `${data.issued_by_name}, ${d(data.issued_at)}`],
                  ["Code", data.code],
                ] as [string, string | null][]
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-border pb-2">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-right">{v}</dd>
                  </div>
                ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
