-- Members upload files with a comment for an event; the event's faculty
-- reviews each one (approve/reject) with their own comment. Mirrors the
-- work_sessions review pattern already used for check-in/check-out approval.
CREATE TYPE public.submission_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE public.submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  comment TEXT,
  status public.submission_status NOT NULL DEFAULT 'pending',
  faculty_comment TEXT,
  reviewed_by UUID REFERENCES auth.users ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.submissions TO authenticated;
GRANT UPDATE (status, faculty_comment, reviewed_by, reviewed_at) ON public.submissions TO authenticated;
GRANT ALL ON public.submissions TO service_role;

ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "submissions_select" ON public.submissions FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.faculty_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "submissions_insert_own" ON public.submissions FOR INSERT TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_id AND pm.student_id = auth.uid()
    )
  );

-- Only the event's owning faculty (or an admin) can review; column-level
-- GRANT above already keeps everyone else from touching file/comment fields.
CREATE POLICY "submissions_review_faculty" ON public.submissions FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.faculty_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.faculty_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

-- Private bucket for uploaded files. Any authenticated user can read (matches
-- this app's existing "campus community is the trust boundary" model already
-- used for profiles/user_roles select), but uploads are confined to a path
-- prefixed with the uploader's own user id so no one can write into another
-- user's folder.
INSERT INTO storage.buckets (id, name, public)
VALUES ('submissions', 'submissions', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "submissions_storage_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'submissions' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "submissions_storage_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'submissions');
