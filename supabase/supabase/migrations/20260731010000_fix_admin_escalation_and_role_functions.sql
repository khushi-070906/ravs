-- self_grant_role let ANY authenticated user grant themselves 'admin' outright
-- (target_role IN ('faculty','admin')), and admin_update_user_role let any
-- 'faculty' (a role anyone can reach via the legitimate self_grant_faculty
-- event-creation flow) grant 'admin' to any other user. Both were also broken
-- by an ON CONFLICT (user_id) clause that doesn't match the table's actual
-- UNIQUE (user_id, role) constraint, which is why every call currently 400s —
-- that bug was accidentally the only thing preventing live exploitation.
-- self_grant_role has no legitimate caller (the UI uses self_grant_faculty),
-- so it is removed outright rather than repaired.
DROP FUNCTION IF EXISTS public.self_grant_role(public.app_role);

CREATE OR REPLACE FUNCTION public.admin_update_user_role(target_user_id UUID, new_role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can update user roles';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = target_user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (target_user_id, new_role);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role(UUID, public.app_role) TO authenticated;
