import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Award, Download, ExternalLink, Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Certificate } from "@/lib/certificate-pdf";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Member = { student_id: string; student_name: string };

export function CertificatesPanel({
  projectId,
  canManage,
  members,
}: {
  projectId: string;
  canManage: boolean;
  members: Member[];
}) {
  const qc = useQueryClient();
  const [student, setStudent] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: certs } = useQuery({
    queryKey: ["certificates", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_certificates")
        .select("*")
        .eq("project_id", projectId)
        .order("issued_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Certificate[];
    },
  });

  const issue = useMutation({
    mutationFn: async () => {
      if (!student) throw new Error("Pick a student");
      const { data, error } = await supabase.rpc("issue_certificate", {
        p_student: student,
        p_project: projectId,
      });
      if (error) throw error;
      return data as Certificate;
    },
    onSuccess: async (c) => {
      toast.success(`Certificate issued to ${c.student_name}`);
      setStudent("");
      qc.invalidateQueries({ queryKey: ["certificates", projectId] });
      await download(c);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async (c: Certificate) => {
      const reason = prompt(`Revoke ${c.student_name}'s certificate? Reason (optional):`);
      if (reason === null) return false;
      const { error } = await supabase.rpc("revoke_certificate", { p_id: c.id, p_reason: reason });
      if (error) throw error;
      return true;
    },
    onSuccess: (done) => {
      if (!done) return;
      toast.success("Certificate revoked. The verify page now shows it as invalid.");
      qc.invalidateQueries({ queryKey: ["certificates", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function download(c: Certificate) {
    setBusyId(c.id);
    try {
      // jsPDF is heavy; load it only when someone downloads
      const { downloadCertificatePdf } = await import("@/lib/certificate-pdf");
      await downloadCertificatePdf(c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the PDF");
    } finally {
      setBusyId(null);
    }
  }

  const list = certs ?? [];
  if (!canManage && list.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 text-base">
        <Award className="size-4" /> Certificates
      </h2>

      {canManage && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Issues a signed PDF from verified hours in the term. Reissuing replaces the old one.
          </p>
          <div className="flex gap-2">
            <Select value={student} onValueChange={setStudent}>
              <SelectTrigger className="h-8 min-w-0 flex-1 text-xs" aria-label="Student">
                <SelectValue placeholder="Choose student" />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.student_id} value={m.student_id}>
                    {m.student_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8"
              onClick={() => issue.mutate()}
              disabled={issue.isPending}
            >
              Issue
            </Button>
          </div>
        </div>
      )}

      {list.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {list.map((c) => (
            <li key={c.id} className={cn("py-2.5 text-sm", c.revoked_at && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.student_name}</p>
                  <p className="tnum text-xs text-muted-foreground">
                    {Math.round((c.verified_minutes / 60) * 10) / 10}h · {c.progress_pct}% ·{" "}
                    {new Date(c.issued_at).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                    })}
                    {c.revoked_at && " · revoked"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="Download PDF"
                    onClick={() => download(c)}
                    disabled={busyId === c.id}
                  >
                    <Download className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" asChild>
                    <Link
                      to="/verify/$code"
                      params={{ code: c.code }}
                      aria-label="Open verify page"
                    >
                      <ExternalLink className="size-3.5" />
                    </Link>
                  </Button>
                  {canManage && !c.revoked_at && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      aria-label="Revoke"
                      onClick={() => revoke.mutate(c)}
                    >
                      <Ban className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
