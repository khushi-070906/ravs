-- user_roles_insert_self_non_admin let any authenticated user grant themselves
-- the 'faculty' role directly (only 'admin' was blocked), bypassing the intended
-- student/faculty distinction that gates project creation and session approval.
-- Role assignment already happens via the SECURITY DEFINER handle_new_user
-- trigger at signup, which bypasses RLS, so the client never needs direct
-- INSERT access to this table.
DROP POLICY IF EXISTS "user_roles_insert_self_non_admin" ON public.user_roles;
REVOKE INSERT ON public.user_roles FROM authenticated;

-- sessions_insert_own only checked student_id = auth.uid(), so a student could
-- log (and get faculty to review) work sessions against any project_id, even
-- one they never joined via project_members. Require actual membership.
DROP POLICY IF EXISTS "sessions_insert_own" ON public.work_sessions;
CREATE POLICY "sessions_insert_own" ON public.work_sessions FOR INSERT TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_id AND pm.student_id = auth.uid()
    )
  );
