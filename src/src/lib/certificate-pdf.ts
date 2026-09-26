import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Certificate = Database["public"]["CompositeTypes"]["attendance_certificate"];

const INK = [28, 32, 38] as const;
const MUTED = [110, 116, 125] as const;
const RULE = [210, 214, 220] as const;

const d = (iso: string | null) =>
  iso
    ? new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;
const t = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const h = (mins: number) => `${Math.round((mins / 60) * 10) / 10}h`;

export function verifyUrl(code: string) {
  return `${window.location.origin}/verify/${code}`;
}

async function approvedSessions(c: Certificate) {
  let q = supabase
    .from("work_sessions")
    .select("check_in_at, check_out_at, duration_minutes, check_in_method, summary")
    .eq("student_id", c.student_id)
    .eq("project_id", c.project_id)
    .eq("status", "approved")
    .order("check_in_at");
  if (c.period_start) q = q.gte("check_in_at", c.period_start);
  if (c.period_end) q = q.lt("check_in_at", `${c.period_end}T23:59:59.999`);
  const { data } = await q;
  return data ?? [];
}

export async function downloadCertificatePdf(c: Certificate) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 20;

  const color = (c3: readonly number[]) => doc.setTextColor(c3[0], c3[1], c3[2]);

  // frame
  doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
  doc.setLineWidth(0.4);
  doc.rect(10, 10, W - 20, H - 20);

  let y = 32;
  color(MUTED);
  doc.setFont("helvetica", "normal").setFontSize(10);
  doc.text(c.institution_name.toUpperCase(), W / 2, y, { align: "center", charSpace: 0.6 });

  y += 14;
  color(INK);
  doc.setFont("times", "bold").setFontSize(26);
  doc.text("Certificate of Research Attendance", W / 2, y, { align: "center" });

  y += 18;
  doc.setFont("times", "normal").setFontSize(13);
  color(MUTED);
  doc.text("This is to certify that", W / 2, y, { align: "center" });

  y += 12;
  color(INK);
  doc.setFont("times", "bold").setFontSize(22);
  doc.text(c.student_name, W / 2, y, { align: "center" });
  if (c.student_college_id) {
    y += 7;
    doc.setFont("helvetica", "normal").setFontSize(10);
    color(MUTED);
    doc.text(c.student_college_id, W / 2, y, { align: "center" });
  }

  y += 12;
  doc.setFont("times", "normal").setFontSize(13);
  color(INK);
  const period = [d(c.period_start), d(c.period_end)].filter(Boolean).join(" to ");
  const sentence =
    `logged ${h(c.verified_minutes)} of faculty-verified research time across ` +
    `${c.session_count} session${c.session_count === 1 ? "" : "s"} on "${c.project_title}"` +
    (c.term_label ? `, ${c.term_label}` : "") +
    (period ? ` (${period})` : "") +
    ".";
  const lines = doc.splitTextToSize(sentence, W - 2 * M - 20);
  doc.text(lines, W / 2, y, { align: "center", lineHeightFactor: 1.5 });
  y += lines.length * 7 + 10;

  // figures
  const meets = c.progress_pct >= c.min_attendance_pct;
  const cells: [string, string][] = [
    ["Verified", h(c.verified_minutes)],
    ["Required", `${c.required_hours}h`],
    ["Attendance", `${c.progress_pct}%`],
    ["Status", meets ? "Meets requirement" : `Below ${c.min_attendance_pct}%`],
  ];
  const cw = (W - 2 * M) / cells.length;
  doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
  doc.line(M, y, W - M, y);
  cells.forEach(([k, v], i) => {
    const x = M + cw * i + cw / 2;
    doc.setFont("helvetica", "normal").setFontSize(9);
    color(MUTED);
    doc.text(k, x, y + 8, { align: "center" });
    doc.setFont("helvetica", "bold").setFontSize(i === 3 ? 11 : 15);
    color(INK);
    doc.text(v, x, y + 16, { align: "center" });
  });
  y += 22;
  doc.line(M, y, W - M, y);
  if (c.excused_minutes > 0) {
    y += 6;
    doc.setFont("helvetica", "normal").setFontSize(9);
    color(MUTED);
    doc.text(
      `Requirement reduced by ${h(c.excused_minutes)} of scheduled lab time excused on approved leave.`,
      W / 2,
      y,
      { align: "center" },
    );
  }

  // signature + verification block
  const by = H - 78;
  doc.setFont("times", "italic").setFontSize(16);
  color(INK);
  doc.text(c.issued_by_name, M, by);
  doc.setDrawColor(INK[0], INK[1], INK[2]);
  doc.line(M, by + 3, M + 75, by + 3);
  doc.setFont("helvetica", "normal").setFontSize(9);
  color(MUTED);
  doc.text("Supervisor, digitally issued in RAVS", M, by + 9);
  doc.text(`Issued ${d(c.issued_at)}`, M, by + 14);

  const qr = await QRCode.toDataURL(verifyUrl(c.code), { margin: 0, width: 300 });
  const qs = 34;
  doc.addImage(qr, "PNG", W - M - qs, by - 18, qs, qs);
  doc.setFontSize(8);
  doc.text("Scan or visit to verify", W - M - qs / 2, by + 21, { align: "center" });
  doc.setFont("courier", "bold").setFontSize(10);
  color(INK);
  doc.text(c.code, W - M - qs / 2, by + 26, { align: "center" });

  doc.setFont("helvetica", "normal").setFontSize(7.5);
  color(MUTED);
  doc.text(verifyUrl(c.code), W / 2, H - 16, { align: "center" });

  if (c.revoked_at) {
    doc.setTextColor(200, 40, 40);
    doc.setFont("helvetica", "bold").setFontSize(64);
    doc.text("REVOKED", W / 2, H / 2, { align: "center", angle: 30 });
  }

  // appendix: session log
  const rows = await approvedSessions(c);
  if (rows.length > 0) {
    doc.addPage();
    let py = 24;
    const header = () => {
      doc.setFont("helvetica", "bold").setFontSize(12);
      color(INK);
      doc.text(`Verified session log — ${c.student_name}`, M, py);
      py += 5;
      doc.setFont("helvetica", "normal").setFontSize(8);
      color(MUTED);
      doc.text(`${c.project_title}  ·  certificate ${c.code}`, M, py);
      py += 8;
      doc.setFont("helvetica", "bold").setFontSize(8);
      color(MUTED);
      doc.text("Date", M, py);
      doc.text("Time", M + 28, py);
      doc.text("Duration", M + 56, py);
      doc.text("Check-in", M + 76, py);
      doc.text("Work summary", M + 96, py);
      py += 2;
      doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
      doc.line(M, py, W - M, py);
      py += 5;
    };
    header();
    doc.setFont("helvetica", "normal").setFontSize(8);
    for (const s of rows) {
      const summary = doc.splitTextToSize((s.summary ?? "").replace(/\s+/g, " "), W - M - (M + 96));
      const shown = summary.slice(0, 2);
      const rowH = Math.max(1, shown.length) * 3.6 + 2.4;
      if (py + rowH > H - 20) {
        doc.addPage();
        py = 24;
        header();
        doc.setFont("helvetica", "normal").setFontSize(8);
      }
      color(INK);
      doc.text(d(s.check_in_at) ?? "", M, py);
      doc.text(`${t(s.check_in_at)}${s.check_out_at ? `–${t(s.check_out_at)}` : ""}`, M + 28, py);
      doc.text(h(s.duration_minutes ?? 0), M + 56, py);
      doc.text(s.check_in_method === "code" ? "Lab code" : "Manual", M + 76, py);
      color(MUTED);
      doc.text(shown, M + 96, py);
      py += rowH;
    }
  }

  doc.save(`RAVS-certificate-${c.student_name.replace(/[^A-Za-z0-9]+/g, "_")}-${c.code}.pdf`);
}
