-- Expose RPC function to let Faculty and Admin update user roles safely
CREATE OR REPLACE FUNCTION public.admin_update_user_role(target_user_id UUID, new_role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'faculty') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (target_user_id, new_role)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
  ELSE
    RAISE EXCEPTION 'Only faculty or admin can update user roles';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role(UUID, public.app_role) TO authenticated;
