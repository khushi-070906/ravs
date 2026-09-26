import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Share2, UserMinus, ShieldAlert, Paperclip, Check, X, Pencil, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { attachStudentNames } from "@/lib/people";
import { hoursFrom } from "@/lib/session-utils";
import {
  HoursProgress,
  MetricStrip,
  RecommendationBadge,
  ResearchLog,
  StatusBadge,
} from "@/components/research";
import { EventEditor } from "@/components/event-editor";
import { useDepartments, useLabs, useRecommendations, useStaff } from "@/lib/institution";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function initialsFor(name: string) {
  return (
    name
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({
    meta: [
      { title: "Event — RAVS" },
      {
        name: "description",
        content: "Event details, roster, roles and logged research sessions.",
      },
      { property: "og:title", content: "Event — RAVS" },
      { property: "og:description", content: "Roster and verified session history." },
    ],
  }),
  component: ProjectDetail,
});

function ProjectDetail() {
  const { id } = Route.useParams();
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const isFaculty = role === "admin" || role === "faculty";
  const isAdmin = role === "admin";

  const { data, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: async () => {
      const { data: project, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;

      const [{ data: members }, { data: sessions }] = await Promise.all([
        supabase.from("project_members").select("student_id").eq("project_id", id),
        supabase
          .from("work_sessions")
          .select("*")
          .eq("project_id", id)
          .order("check_in_at", { ascending: false }),
      ]);

      return {
        project,
        members: await attachStudentNames(members ?? []),
        sessions: await attachStudentNames(sessions ?? []),
      };
    },
  });

  const toggleJoin = useMutation({
    mutationFn: async (isJoined: boolean) => {
      if (isJoined) {
        const { error } = await supabase
          .from("project_members")
          .delete()
          .eq("project_id", id)
          .eq("student_id", user!.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("project_members")
          .insert({ project_id: id, student_id: user!.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", id] });
      toast.success("Roster updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateRole = useMutation({
    mutationFn: async ({
      userId,
      newRole,
    }: {
      userId: string;
      newRole: "student" | "faculty" | "admin";
    }) => {
      const { error } = await supabase.rpc("admin_update_user_role", {
        target_user_id: userId,
        new_role: newRole,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Member role updated");
      qc.invalidateQueries({ queryKey: ["project", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from("project_members")
        .delete()
        .eq("project_id", id)
        .eq("student_id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Member removed from event");
      qc.invalidateQueries({ queryKey: ["project", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadComment, setUploadComment] = useState("");
  const [reviewComments, setReviewComments] = useState<Record<string, string>>({});

  const { data: submissions } = useQuery({
    queryKey: ["submissions", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("submissions")
        .select("*")
        .eq("project_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return attachStudentNames(data ?? []);
    },
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!uploadFile) throw new Error("Choose a file to upload");
      // Storage keys reject many characters (spaces, #, [], non-ASCII…).
      const safeName = uploadFile.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120) || "file";
      const path = `${user!.id}/${id}/${Date.now()}-${safeName}`;
      const { error: uploadErr } = await supabase.storage
        .from("submissions")
        .upload(path, uploadFile);
      if (uploadErr) throw uploadErr;
      const { error } = await supabase.from("submissions").insert({
        project_id: id,
        student_id: user!.id,
        file_path: path,
        file_name: uploadFile.name,
        comment: uploadComment.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setUploadFile(null);
      setUploadComment("");
      toast.success("Uploaded for review");
      qc.invalidateQueries({ queryKey: ["submissions", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const review = useMutation({
    mutationFn: async ({
      submissionId,
      status,
    }: {
      submissionId: string;
      status: "approved" | "rejected";
    }) => {
      const { error } = await supabase
        .from("submissions")
        .update({
          status,
          faculty_comment: (reviewComments[submissionId] ?? "").trim() || null,
          reviewed_by: user!.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", submissionId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Submission reviewed");
      qc.invalidateQueries({ queryKey: ["submissions", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const facultyId = data?.project?.faculty_id;
  const { data: supervisor } = useQuery({
    queryKey: ["supervisor", facultyId],
    enabled: !!facultyId,
    queryFn: async () => {
      const { data: p } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", facultyId!)
        .maybeSingle();
      return p?.full_name ?? null;
    },
  });

  const [editing, setEditing] = useState(false);
  const [logLimit, setLogLimit] = useState(15);
  const { data: departments } = useDepartments();
  const { data: labs } = useLabs();
  const { data: staff } = useStaff();
  const { data: recs } = useRecommendations(id, !!user);
  const { data: slots } = useQuery({
    queryKey: ["project-slots", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("schedule_slots")
        .select("id, title, kind, starts_at, ends_at, location")
        .eq("project_id", id)
        .gte("starts_at", new Date().toISOString())
        .order("starts_at")
        .limit(5);
      return data ?? [];
    },
  });

  async function viewFile(filePath: string) {
    const { data, error } = await supabase.storage
      .from("submissions")
      .createSignedUrl(filePath, 60);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading project…</p>;
  if (!data?.project) return <p className="text-sm text-muted-foreground">Event not found.</p>;

  const { project, members, sessions } = data;
  const isJoined = members.some((m) => m.student_id === user?.id);
  const sum = (xs: typeof sessions, st: string) =>
    xs.filter((s) => s.status === st).reduce((a, s) => a + (s.duration_minutes ?? 0), 0);
  const approvedMins = sum(sessions, "approved");
  const mySessions = sessions.filter((s) => s.student_id === user?.id);
  const awaiting = sessions.filter((s) => s.status === "pending").length;
  const canManage =
    isAdmin || project.faculty_id === user?.id || project.co_supervisor_id === user?.id;
  const dept = departments?.find((d) => d.id === project.department_id);
  const lab = labs?.find((l) => l.id === project.lab_id);
  const coSup = staff?.find((s) => s.id === project.co_supervisor_id);
  const fmtD = (d: string | null) =>
    d
      ? new Date(d).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : null;
  const recFor = (sid: string) => (recs ?? []).find((r) => r.student_id === sid);

  const shareEvent = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success("Event link copied");
  };

  return (
    <div className="space-y-8">
      <div className="border-b border-border pb-6">
        <Link to="/projects" className="text-xs text-muted-foreground hover:underline">
          Events
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-3xl">{project.title}</h1>
              <StatusBadge kind="event" status={project.status} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {[
                dept?.name,
                lab?.name ?? project.lab_name,
                supervisor && `Supervised by ${supervisor}${coSup ? ` and ${coSup.name}` : ""}`,
              ]
                .filter(Boolean)
                .join("  /  ")}
            </p>
            {project.description && (
              <p className="mt-4 font-serif text-[17px] leading-relaxed">{project.description}</p>
            )}
            {(project.keywords ?? []).length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Keywords">
                {(project.keywords ?? []).map((k) => (
                  <li
                    key={k}
                    className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground"
                  >
                    {k}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canManage && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Edit
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={shareEvent}>
              <Share2 className="size-4" /> Copy link
            </Button>
            {!isFaculty && (
              <Button
                size="sm"
                variant={isJoined ? "ghost" : "default"}
                onClick={() => toggleJoin.mutate(isJoined)}
                disabled={toggleJoin.isPending}
              >
                {isJoined ? "Leave event" : "Join event"}
              </Button>
            )}
          </div>
        </div>
        {!isFaculty && isJoined && (
          <div className="mt-6 max-w-md">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium">Your progress</p>
              {user && recFor(user.id) && (
                <RecommendationBadge value={recFor(user.id)!.recommendation} />
              )}
            </div>
            <HoursProgress
              approvedMins={sum(mySessions, "approved")}
              pendingMins={sum(mySessions, "pending")}
              requiredHours={project.required_hours}
            />
          </div>
        )}
      </div>

      <MetricStrip
        items={[
          { label: "Verified hours", value: `${hoursFrom(approvedMins)}h`, hint: "All members" },
          { label: "Members", value: String(members.length) },
          {
            label: "Sessions logged",
            value: String(sessions.length),
            hint: `${awaiting} awaiting review`,
          },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-10">
          <section>
            <h2 className="mb-4 text-xl">Research log</h2>
            <ResearchLog
              sessions={sessions.slice(0, logLimit)}
              showStudent
              showEvent={false}
              empty="No sessions logged against this event yet."
            />
            {sessions.length > logLimit && (
              <Button variant="outline" className="mt-4" onClick={() => setLogLimit(logLimit + 30)}>
                Show older entries ({sessions.length - logLimit})
              </Button>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-xl">Files and outputs</h2>

            {isJoined && (
              <div className="space-y-3 rounded-lg border border-border bg-card p-4">
                <Label htmlFor="upload">Upload a report, dataset or code</Label>
                <Input
                  id="upload"
                  type="file"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                />
                <Textarea
                  rows={2}
                  placeholder="What is this file? e.g. Week 3 benchmark report"
                  value={uploadComment}
                  onChange={(e) => setUploadComment(e.target.value)}
                  maxLength={1000}
                />
                <Button
                  size="sm"
                  onClick={() => upload.mutate()}
                  disabled={upload.isPending || !uploadFile}
                >
                  <Paperclip className="size-4" /> Upload for review
                </Button>
              </div>
            )}

            {(submissions ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                No files uploaded yet.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {(submissions ?? []).map((s) => (
                  <li key={s.id} className="p-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <button
                        onClick={() => viewFile(s.file_path)}
                        className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium hover:underline"
                      >
                        <Paperclip className="size-3.5 shrink-0" />
                        <span className="truncate">{s.file_name}</span>
                      </button>
                      <StatusBadge status={s.status} className="ml-auto" />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {s.student_name}, {new Date(s.created_at).toLocaleString()}
                    </p>
                    {s.comment && <p className="mt-2 font-serif text-[15px]">{s.comment}</p>}
                    {s.faculty_comment && (
                      <p className="mt-2 border-l-2 border-border pl-3 text-sm text-muted-foreground">
                        Reviewer: {s.faculty_comment}
                      </p>
                    )}

                    {isFaculty && s.status === "pending" && (
                      <div className="mt-3 space-y-2">
                        <Textarea
                          rows={2}
                          placeholder="Comment for the student (optional)"
                          value={reviewComments[s.id] ?? ""}
                          onChange={(e) =>
                            setReviewComments({ ...reviewComments, [s.id]: e.target.value })
                          }
                          maxLength={1000}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() =>
                              review.mutate({ submissionId: s.id, status: "approved" })
                            }
                            disabled={review.isPending}
                          >
                            <Check className="size-4" /> Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              review.mutate({ submissionId: s.id, status: "rejected" })
                            }
                            disabled={review.isPending}
                          >
                            <X className="size-4" /> Return
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-10 lg:self-start">
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-base">About</h2>
            <dl className="mt-3 space-y-2 text-sm">
              {[
                ["Research area", project.domain],
                [
                  "Runs",
                  [fmtD(project.start_date), fmtD(project.end_date)].filter(Boolean).join(" – ") ||
                    null,
                ],
                ["Required", `${project.required_hours}h per student`],
                [
                  "Members",
                  project.max_members
                    ? `${members.length} of ${project.max_members}`
                    : `${members.length}`,
                ],
                ["Funding", project.funding_source],
                ["Lab location", lab?.location],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k as string} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-right">{v}</dd>
                  </div>
                ))}
            </dl>
            {project.objectives && (
              <div className="mt-4 border-t border-border pt-3">
                <p className="text-xs font-medium text-muted-foreground">Objectives</p>
                <p className="mt-1 whitespace-pre-line font-serif text-[15px] leading-relaxed">
                  {project.objectives}
                </p>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base">Schedule</h2>
              <Link to="/calendar" className="text-xs text-muted-foreground hover:underline">
                Calendar
              </Link>
            </div>
            {(slots ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing scheduled.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {(slots ?? []).map((sl) => (
                  <li key={sl.id} className="text-sm">
                    <p className="font-medium">{sl.title}</p>
                    <p className="tnum text-xs text-muted-foreground">
                      {new Date(sl.starts_at).toLocaleString(undefined, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    {sl.location && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" /> {sl.location}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base">Members</h2>
              {isAdmin && (
                <span title="You can change member roles" className="text-muted-foreground">
                  <ShieldAlert className="size-3.5" />
                </span>
              )}
            </div>

            {members.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                Nobody has joined yet. Copy the link and share it with your students.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {members.map((m) => {
                  const ms = sessions.filter((s) => s.student_id === m.student_id);
                  return (
                    <li key={m.student_id} className="space-y-2 p-3">
                      <div className="flex items-center gap-2">
                        <Avatar className="size-8 shrink-0">
                          <AvatarFallback className="bg-secondary text-xs">
                            {initialsFor(m.student_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {m.student_name}
                            {m.student_id === user?.id && " (you)"}
                          </p>
                          {m.student_college_id && (
                            <p className="truncate text-xs text-muted-foreground">
                              {m.student_college_id}
                            </p>
                          )}
                        </div>

                        {isAdmin && (
                          <Select
                            value={m.student_role}
                            onValueChange={(newRole) =>
                              updateRole.mutate({
                                userId: m.student_id,
                                newRole: newRole as "student" | "faculty" | "admin",
                              })
                            }
                            disabled={updateRole.isPending}
                          >
                            <SelectTrigger
                              className="h-7 w-[88px] shrink-0 text-xs capitalize"
                              aria-label={`Role for ${m.student_name}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="student">Student</SelectItem>
                              <SelectItem value="faculty">Faculty</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                        )}

                        {isFaculty && m.student_id !== user?.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0 text-destructive hover:bg-destructive/10"
                            aria-label={`Remove ${m.student_name}`}
                            onClick={() => removeMember.mutate(m.student_id)}
                            disabled={removeMember.isPending}
                          >
                            <UserMinus className="size-3.5" />
                          </Button>
                        )}
                      </div>
                      {(isFaculty || m.student_id === user?.id) && (
                        <>
                          <HoursProgress
                            compact
                            approvedMins={sum(ms, "approved")}
                            pendingMins={sum(ms, "pending")}
                            requiredHours={project.required_hours}
                          />
                          {recFor(m.student_id) && (
                            <RecommendationBadge value={recFor(m.student_id)!.recommendation} />
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>
      {canManage && <EventEditor project={project} open={editing} onOpenChange={setEditing} />}
    </div>
  );
}
