-- Allow faculty and admins to view all work sessions and submissions globally.
-- Restrict review/approval UPDATE authority to users holding the 'faculty' role.

DROP POLICY IF EXISTS "sessions_select" ON public.work_sessions;
CREATE POLICY "sessions_select" ON public.work_sessions FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    OR public.has_role(auth.uid(), 'faculty')
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "sessions_update_faculty" ON public.work_sessions;
CREATE POLICY "sessions_update_faculty" ON public.work_sessions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'faculty'))
  WITH CHECK (public.has_role(auth.uid(), 'faculty'));

-- Mirror same global view & faculty-only review policies for event file submissions
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'submissions') THEN
    DROP POLICY IF EXISTS "submissions_select" ON public.submissions;
    CREATE POLICY "submissions_select" ON public.submissions FOR SELECT TO authenticated
      USING (
        student_id = auth.uid()
        OR public.has_role(auth.uid(), 'faculty')
        OR public.has_role(auth.uid(), 'admin')
      );

    DROP POLICY IF EXISTS "submissions_review_faculty" ON public.submissions;
    CREATE POLICY "submissions_review_faculty" ON public.submissions FOR UPDATE TO authenticated
      USING (public.has_role(auth.uid(), 'faculty'))
      WITH CHECK (public.has_role(auth.uid(), 'faculty'));
  END IF;
END $$;
