-- Allow user to self-upgrade to 'faculty' or 'admin' when creating an event
CREATE OR REPLACE FUNCTION public.self_grant_role(target_role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF target_role IN ('faculty', 'admin') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (auth.uid(), target_role)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.self_grant_role(public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.self_grant_role(public.app_role) TO authenticated;
