-- self_grant_faculty only ever INSERTed 'faculty' alongside the existing
-- 'student' row instead of replacing it, so anyone who created an event ended
-- up with two rows in user_roles. lib/auth.tsx reads role via .maybeSingle(),
-- which silently returns null on multiple rows, so the whole app fell back to
-- "student" for these accounts even though they actually hold 'faculty' —
-- hiding faculty-only UI like the submissions review controls.
CREATE OR REPLACE FUNCTION public.self_grant_faculty()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.user_roles WHERE user_id = auth.uid();
  INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), 'faculty');
END;
$$;

-- One-time cleanup: collapse any account already left with multiple rows
-- down to its highest-privilege role (admin > faculty > student).
DELETE FROM public.user_roles a
USING public.user_roles b
WHERE a.user_id = b.user_id
  AND a.ctid <> b.ctid
  AND (
    CASE a.role WHEN 'admin' THEN 3 WHEN 'faculty' THEN 2 ELSE 1 END
    < CASE b.role WHEN 'admin' THEN 3 WHEN 'faculty' THEN 2 ELSE 1 END
  );
