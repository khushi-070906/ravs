-- =============================================================================
-- Lock down the faculty role.
--
-- Bug: a student could get every faculty feature because 'faculty' was
-- self-grantable in two ways:
--   1. Picking "Faculty" on the signup form (handle_new_user trusted
--      raw_user_meta_data->>'role' = 'faculty').
--   2. Creating an event, which called self_grant_faculty() and silently
--      converted the account to faculty permanently.
-- On top of that the portal picker on the sign-in screen was cosmetic, so a
-- faculty account signed in through "Student" still got the faculty UI.
--
-- After this migration a role can only come from:
--   * admin_emails   allowlist  -> admin   (at signup)
--   * faculty_emails allowlist  -> faculty (at signup)
--   * an admin calling admin_update_user_role() (existing UI in event page)
-- Everyone else is a student. The client-supplied metadata role is ignored.
-- =============================================================================

-- 1. Remove the self-promotion RPC entirely.
DROP FUNCTION IF EXISTS public.self_grant_faculty();

-- 2. Faculty allowlist (same pattern as admin_emails).
--    Add faculty from the SQL editor:
--      INSERT INTO public.faculty_emails (email) VALUES ('prof@college.edu');
CREATE TABLE IF NOT EXISTS public.faculty_emails (
  email TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.faculty_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.faculty_emails FROM anon, authenticated;
GRANT ALL ON public.faculty_emails TO service_role;

-- 3. Signup trigger: never trust the client-sent role.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _role public.app_role;
BEGIN
  IF EXISTS (SELECT 1 FROM public.admin_emails WHERE lower(email) = lower(NEW.email)) THEN
    _role := 'admin';
  ELSIF EXISTS (SELECT 1 FROM public.faculty_emails WHERE lower(email) = lower(NEW.email)) THEN
    _role := 'faculty';
  ELSE
    _role := 'student';
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, full_name, college_id, department)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
      COALESCE(NULLIF(NEW.raw_user_meta_data->>'college_id', ''),
               NULLIF(NEW.raw_user_meta_data->>'college', '')),
      NEW.raw_user_meta_data->>'department'
    )
    ON CONFLICT (id) DO UPDATE SET
      full_name  = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.profiles.full_name),
      college_id = COALESCE(EXCLUDED.college_id, public.profiles.college_id),
      department = COALESCE(EXCLUDED.department, public.profiles.department);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: profile insert failed for %: %', NEW.id, SQLERRM;
  END;

  BEGIN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, _role)
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: role insert failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 4. Belt and braces: authenticated users can never write user_roles directly.
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;
DROP POLICY IF EXISTS "user_roles_insert_self_non_admin" ON public.user_roles;

-- 5. Only real staff can create events (unchanged rule, restated so it holds
--    even if an older migration is re-run out of order).
DROP POLICY IF EXISTS "projects_insert_faculty" ON public.projects;
CREATE POLICY "projects_insert_faculty" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (faculty_id = auth.uid() AND public.is_staff(auth.uid()));

-- =============================================================================
-- 6. CLEAN UP accounts that already got promoted by the old bug.
--    Run ONE of these manually in the SQL editor after checking the list.
-- =============================================================================
-- See who is currently faculty/admin:
--   SELECT u.email, r.role FROM public.user_roles r
--   JOIN auth.users u ON u.id = r.user_id
--   WHERE r.role IN ('faculty','admin') ORDER BY r.role, u.email;
--
-- Demote a specific account back to student:
--   UPDATE public.user_roles SET role = 'student'
--   WHERE user_id = (SELECT id FROM auth.users WHERE email = 'student@ravs.edu');
--
-- Keep real faculty working in future signups by allowlisting them:
--   INSERT INTO public.faculty_emails (email) VALUES ('faculty@ravs.edu')
--   ON CONFLICT DO NOTHING;
