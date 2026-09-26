-- lib/auth.tsx self-heals a missing user_roles row by upserting 'student'
-- for the current user, but direct client INSERT on user_roles was revoked
-- in 20260730013000 to close the admin-escalation path, so that upsert now
-- 403s (harmless in the UI — role still falls back to 'student' in memory —
-- but it never persists and spams the console). Expose a narrow function
-- that can only ever insert 'student' for the caller's own id.
CREATE OR REPLACE FUNCTION public.ensure_own_student_role()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'student')
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_own_student_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_own_student_role() TO authenticated;
