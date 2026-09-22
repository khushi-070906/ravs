-- =============================================================================
-- Backend fixes: make every flow the UI exposes actually work, and close the
-- holes that let students approve their own work or sign up as admin.
--
-- Broken before this migration (verified against a local Postgres):
--   * Admins could not create events (projects_insert_faculty required 'faculty').
--   * Admins could not approve/reject sessions or submissions (policies were
--     faculty-only), and PostgREST returned 0 rows silently, so the UI showed
--     "success" while nothing changed.
--   * Faculty/admins could not remove members or archive events they don't own
--     (again silent 0-row no-ops).
--   * A student could UPDATE their own session to status = 'approved' and set
--     any duration_minutes they liked.
--   * The membership check in sessions_insert_own / submissions_insert_own
--     compared pm.project_id to itself (unqualified column resolved to the
--     subquery table), so any membership anywhere passed.
--   * handle_new_user honoured raw_user_meta_data->>'role' = 'admin', so anyone
--     could sign up as admin straight from the signup form.
--   * user_roles only had UNIQUE (user_id, role) while the app assumes exactly
--     one role per user (.maybeSingle()); duplicates broke role loading.
--   * self_grant_faculty would silently demote an admin to faculty.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('faculty', 'admin')
  )
$$;
REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1. user_roles: exactly one role per user
-- -----------------------------------------------------------------------------
-- Collapse any remaining duplicates to the highest-privilege role.
DELETE FROM public.user_roles a
USING public.user_roles b
WHERE a.user_id = b.user_id
  AND a.id <> b.id
  AND (CASE a.role WHEN 'admin' THEN 3 WHEN 'faculty' THEN 2 ELSE 1 END)
    < (CASE b.role WHEN 'admin' THEN 3 WHEN 'faculty' THEN 2 ELSE 1 END);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_roles_user_id_key' AND conrelid = 'public.user_roles'::regclass
  ) THEN
    ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- Backfill: every auth user gets a profile and a role row.
INSERT INTO public.profiles (id, full_name, college_id, department)
SELECT u.id,
       COALESCE(u.raw_user_meta_data->>'full_name', ''),
       COALESCE(u.raw_user_meta_data->>'college_id', u.raw_user_meta_data->>'college'),
       u.raw_user_meta_data->>'department'
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'student' FROM auth.users u
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Admin bootstrap allowlist (the only way to become admin at signup)
-- -----------------------------------------------------------------------------
-- Add emails here from the SQL editor:
--   INSERT INTO public.admin_emails (email) VALUES ('you@college.edu');
-- Accounts that already exist can be promoted with:
--   UPDATE public.user_roles SET role = 'admin'
--   WHERE user_id = (SELECT id FROM auth.users WHERE email = 'you@college.edu');
CREATE TABLE IF NOT EXISTS public.admin_emails (
  email TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_emails FROM anon, authenticated;
GRANT ALL ON public.admin_emails TO service_role;

-- -----------------------------------------------------------------------------
-- 3. Signup trigger: student/faculty from metadata, admin only via allowlist
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _meta_role text := NEW.raw_user_meta_data->>'role';
  _role public.app_role;
BEGIN
  IF EXISTS (SELECT 1 FROM public.admin_emails WHERE lower(email) = lower(NEW.email)) THEN
    _role := 'admin';
  ELSIF _meta_role = 'faculty' THEN
    -- Faculty is already self-grantable via self_grant_faculty(), so honouring
    -- it at signup grants nothing new.
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

-- (on_auth_user_created trigger from the first migration already points here)

-- -----------------------------------------------------------------------------
-- 4. Role RPCs
-- -----------------------------------------------------------------------------
-- Student -> faculty when creating an event. Never touches an admin.
CREATE OR REPLACE FUNCTION public.self_grant_faculty()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), 'faculty')
  ON CONFLICT (user_id) DO UPDATE SET role = 'faculty';
END;
$$;
REVOKE ALL ON FUNCTION public.self_grant_faculty() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.self_grant_faculty() TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_own_student_role()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), 'student')
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_own_student_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_own_student_role() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_user_role(target_user_id UUID, new_role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can update user roles';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  -- Never leave the system without an admin.
  IF new_role <> 'admin'
     AND public.has_role(target_user_id, 'admin')
     AND (SELECT count(*) FROM public.user_roles WHERE role = 'admin') <= 1 THEN
    RAISE EXCEPTION 'Cannot demote the last remaining admin';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (target_user_id, new_role)
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_user_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role(UUID, public.app_role) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. projects: admins can create; owner or admin can update/delete
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "projects_insert_faculty" ON public.projects;
CREATE POLICY "projects_insert_faculty" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (faculty_id = auth.uid() AND public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "projects_update_owner" ON public.projects;
CREATE POLICY "projects_update_owner" ON public.projects FOR UPDATE TO authenticated
  USING (faculty_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (faculty_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "projects_delete_owner" ON public.projects;
CREATE POLICY "projects_delete_owner" ON public.projects FOR DELETE TO authenticated
  USING (faculty_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- -----------------------------------------------------------------------------
-- 6. project_members: self join/leave; staff can remove anyone
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "members_insert" ON public.project_members;
CREATE POLICY "members_insert" ON public.project_members FOR INSERT TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    OR public.is_staff(auth.uid())
  );

DROP POLICY IF EXISTS "members_delete" ON public.project_members;
CREATE POLICY "members_delete" ON public.project_members FOR DELETE TO authenticated
  USING (
    student_id = auth.uid()
    OR public.is_staff(auth.uid())
  );

-- -----------------------------------------------------------------------------
-- 7. work_sessions
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "sessions_insert_own" ON public.work_sessions;
CREATE POLICY "sessions_insert_own" ON public.work_sessions FOR INSERT TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.project_members pm
      JOIN public.projects p ON p.id = pm.project_id
      WHERE pm.project_id = work_sessions.project_id
        AND pm.student_id = auth.uid()
        AND p.status <> 'archived'
    )
  );

DROP POLICY IF EXISTS "sessions_update_faculty" ON public.work_sessions;
CREATE POLICY "sessions_update_faculty" ON public.work_sessions FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- Server-side state machine. RLS decides *who* may touch a row; this decides
-- *what* they may change. auth.uid() IS NULL means service role / SQL editor.
CREATE OR REPLACE FUNCTION public.work_sessions_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _staff boolean;
BEGIN
  IF _uid IS NULL THEN
    IF NEW.check_out_at IS NOT NULL THEN
      NEW.duration_minutes := GREATEST(0, floor(extract(epoch FROM (NEW.check_out_at - NEW.check_in_at)) / 60))::int;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status := 'active';
    NEW.check_in_at := now();
    NEW.check_out_at := NULL;
    NEW.duration_minutes := NULL;
    NEW.summary := NULL;
    NEW.submitted_at := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.remarks := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: identity and timing columns are immutable for everyone.
  NEW.id := OLD.id;
  NEW.student_id := OLD.student_id;
  NEW.project_id := OLD.project_id;
  NEW.check_in_at := OLD.check_in_at;
  NEW.created_at := OLD.created_at;

  _staff := public.is_staff(_uid);

  IF _uid = OLD.student_id THEN
    -- Student acting on their own session.
    IF NEW.status NOT IN ('active', 'pending') THEN
      RAISE EXCEPTION 'You cannot review your own session';
    END IF;

    IF OLD.status = 'active' AND NEW.status = 'pending' THEN
      -- Check-out: server clock decides the duration.
      NEW.check_out_at := now();
      NEW.submitted_at := now();
    ELSIF OLD.status = 'rejected' AND NEW.status = 'pending' THEN
      -- Resubmission after rejection keeps the original timing.
      NEW.check_out_at := OLD.check_out_at;
      NEW.submitted_at := now();
    ELSIF NEW.status = OLD.status THEN
      NEW.check_out_at := OLD.check_out_at;
      NEW.submitted_at := OLD.submitted_at;
    ELSE
      RAISE EXCEPTION 'Invalid session status change: % -> %', OLD.status, NEW.status;
    END IF;

    NEW.reviewed_by := CASE WHEN NEW.status = 'pending' AND OLD.status = 'rejected' THEN NULL ELSE OLD.reviewed_by END;
    NEW.reviewed_at := CASE WHEN NEW.status = 'pending' AND OLD.status = 'rejected' THEN NULL ELSE OLD.reviewed_at END;
    NEW.remarks := OLD.remarks;
  ELSIF _staff THEN
    -- Reviewer: may only move pending -> approved/rejected (or re-decide).
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status NOT IN ('pending', 'approved', 'rejected') OR NEW.status NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'Invalid review status change: % -> %', OLD.status, NEW.status;
      END IF;
      NEW.reviewed_by := _uid;
      NEW.reviewed_at := now();
    ELSE
      NEW.reviewed_by := OLD.reviewed_by;
      NEW.reviewed_at := OLD.reviewed_at;
    END IF;
    NEW.check_out_at := OLD.check_out_at;
    NEW.submitted_at := OLD.submitted_at;
    NEW.summary := OLD.summary;
    NEW.notes := OLD.notes;
  ELSE
    RAISE EXCEPTION 'Not allowed to modify this session';
  END IF;

  IF NEW.check_out_at IS NOT NULL THEN
    NEW.duration_minutes := GREATEST(0, floor(extract(epoch FROM (NEW.check_out_at - NEW.check_in_at)) / 60))::int;
  ELSE
    NEW.duration_minutes := NULL;
  END IF;

  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.work_sessions_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS work_sessions_guard ON public.work_sessions;
CREATE TRIGGER work_sessions_guard BEFORE INSERT OR UPDATE ON public.work_sessions
FOR EACH ROW EXECUTE FUNCTION public.work_sessions_guard();

-- -----------------------------------------------------------------------------
-- 8. submissions
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "submissions_insert_own" ON public.submissions;
CREATE POLICY "submissions_insert_own" ON public.submissions FOR INSERT TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = submissions.project_id
        AND pm.student_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "submissions_review_faculty" ON public.submissions;
CREATE POLICY "submissions_review_faculty" ON public.submissions FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()) AND student_id <> auth.uid())
  WITH CHECK (public.is_staff(auth.uid()) AND student_id <> auth.uid());

-- Students may withdraw their own pending submissions.
GRANT DELETE ON public.submissions TO authenticated;
DROP POLICY IF EXISTS "submissions_delete_own_pending" ON public.submissions;
CREATE POLICY "submissions_delete_own_pending" ON public.submissions FOR DELETE TO authenticated
  USING (student_id = auth.uid() AND status = 'pending');

CREATE OR REPLACE FUNCTION public.submissions_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.faculty_comment := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.faculty_comment IS DISTINCT FROM OLD.faculty_comment THEN
    NEW.reviewed_by := auth.uid();
    NEW.reviewed_at := now();
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.submissions_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS submissions_guard ON public.submissions;
CREATE TRIGGER submissions_guard BEFORE INSERT OR UPDATE ON public.submissions
FOR EACH ROW EXECUTE FUNCTION public.submissions_guard();

-- -----------------------------------------------------------------------------
-- 9. Storage bucket: make sure it exists, cap size, allow owner delete
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('submissions', 'submissions', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'file_size_limit'
  ) THEN
    UPDATE storage.buckets SET file_size_limit = 52428800 WHERE id = 'submissions'; -- 50 MB
  END IF;
END $$;

DROP POLICY IF EXISTS "submissions_storage_delete_own" ON storage.objects;
CREATE POLICY "submissions_storage_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'submissions' AND (storage.foldername(name))[1] = auth.uid()::text);

-- -----------------------------------------------------------------------------
-- 10. Indexes for the queries the UI actually runs
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS work_sessions_project_idx ON public.work_sessions (project_id, check_in_at DESC);
CREATE INDEX IF NOT EXISTS work_sessions_student_idx ON public.work_sessions (student_id, check_in_at DESC);
CREATE INDEX IF NOT EXISTS work_sessions_status_idx  ON public.work_sessions (status, submitted_at);
CREATE INDEX IF NOT EXISTS project_members_student_idx ON public.project_members (student_id);
CREATE INDEX IF NOT EXISTS submissions_project_idx ON public.submissions (project_id, created_at DESC);
