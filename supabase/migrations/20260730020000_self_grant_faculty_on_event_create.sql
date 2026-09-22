-- Everyone signs up as 'student' now (no role picker at signup). The only way
-- to become 'faculty' is by choosing that role in the "Create event" dialog.
-- Rather than reopening direct client INSERT on user_roles (the privilege-
-- escalation gap closed in 20260730013000), expose a narrow SECURITY DEFINER
-- function that can only ever grant 'faculty' to the calling user themselves —
-- never an arbitrary user, and never 'admin'.
CREATE OR REPLACE FUNCTION public.self_grant_faculty()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'faculty')
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.self_grant_faculty() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.self_grant_faculty() TO authenticated;
