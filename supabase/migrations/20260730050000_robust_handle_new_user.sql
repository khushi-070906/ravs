-- Make handle_new_user trigger exception-safe so auth signups never fail with HTTP 400
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, college_id, department)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name',''),
    COALESCE(NEW.raw_user_meta_data->>'college_id', NEW.raw_user_meta_data->>'college'),
    NEW.raw_user_meta_data->>'department'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    college_id = COALESCE(EXCLUDED.college_id, public.profiles.college_id);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    (CASE
      WHEN NEW.raw_user_meta_data->>'role' IN ('student','faculty','admin') THEN NEW.raw_user_meta_data->>'role'
      ELSE 'student'
    END)::public.app_role
  )
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END; $$;
