-- =============================================================================
-- RAVS — Phase 1 (institutional core) + Phase 2 (verification infrastructure)
-- + calendar / schedule.
--
--   departments, labs, institution_settings        (Phase 1)
--   projects: department, lab, domain, keywords,    (Phase 1)
--             funding, co-supervisor, member cap
--   admin_list_users / admin_set_user_department   (Phase 1)
--   schedule_slots                                  (calendar + schedule)
--   audit_log  + triggers                           (Phase 2)
--   notifications + triggers                        (Phase 2)
--   attendance_recommendations()                    (Phase 2)
--
-- Safe to run once on top of 20260926000000_lock_down_faculty_role.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Departments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  code TEXT UNIQUE,
  head_id UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;
DROP POLICY IF EXISTS "departments_select" ON public.departments;
CREATE POLICY "departments_select" ON public.departments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "departments_admin_write" ON public.departments;
CREATE POLICY "departments_admin_write" ON public.departments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- -----------------------------------------------------------------------------
-- 2. Laboratories
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.labs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  department_id UUID REFERENCES public.departments ON DELETE SET NULL,
  location TEXT,
  incharge_id UUID REFERENCES auth.users ON DELETE SET NULL,
  capacity INT CHECK (capacity IS NULL OR capacity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, department_id)
);
ALTER TABLE public.labs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.labs TO authenticated;
GRANT ALL ON public.labs TO service_role;
DROP POLICY IF EXISTS "labs_select" ON public.labs;
CREATE POLICY "labs_select" ON public.labs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "labs_admin_write" ON public.labs;
CREATE POLICY "labs_admin_write" ON public.labs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- -----------------------------------------------------------------------------
-- 3. Institution configuration (single row)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.institution_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  name TEXT NOT NULL DEFAULT 'My Institution',
  short_name TEXT,
  academic_year TEXT,
  semester_label TEXT,
  semester_start DATE,
  semester_end DATE,
  min_attendance_pct INT NOT NULL DEFAULT 75 CHECK (min_attendance_pct BETWEEN 0 AND 100),
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (semester_end IS NULL OR semester_start IS NULL OR semester_end >= semester_start)
);
INSERT INTO public.institution_settings (id) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE public.institution_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.institution_settings TO authenticated;
GRANT ALL ON public.institution_settings TO service_role;
DROP POLICY IF EXISTS "settings_select" ON public.institution_settings;
CREATE POLICY "settings_select" ON public.institution_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "settings_admin_update" ON public.institution_settings;
CREATE POLICY "settings_admin_update" ON public.institution_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS trg_settings_updated ON public.institution_settings;
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON public.institution_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Profiles: department link; admins may edit any profile
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments ON DELETE SET NULL;
DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
CREATE POLICY "profiles_update_admin" ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- -----------------------------------------------------------------------------
-- 5. Project metadata
-- -----------------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lab_id UUID REFERENCES public.labs ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS co_supervisor_id UUID REFERENCES auth.users ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS domain TEXT,
  ADD COLUMN IF NOT EXISTS keywords TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS funding_source TEXT,
  ADD COLUMN IF NOT EXISTS max_members INT CHECK (max_members IS NULL OR max_members > 0);

-- Enforce member cap and "only active events can be joined".
CREATE OR REPLACE FUNCTION public.project_members_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p public.projects%ROWTYPE;
BEGIN
  SELECT * INTO _p FROM public.projects WHERE id = NEW.project_id;
  IF _p.status <> 'active' AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'This event is closed for new members';
  END IF;
  IF _p.max_members IS NOT NULL
     AND (SELECT count(*) FROM public.project_members WHERE project_id = NEW.project_id) >= _p.max_members THEN
    RAISE EXCEPTION 'This event is full (% members)', _p.max_members;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_project_members_guard ON public.project_members;
CREATE TRIGGER trg_project_members_guard BEFORE INSERT ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION public.project_members_guard();

-- -----------------------------------------------------------------------------
-- 6. Admin user management
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id UUID, email TEXT, full_name TEXT, college_id TEXT, role public.app_role,
  department_id UUID, created_at TIMESTAMPTZ, last_sign_in_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can list users';
  END IF;
  RETURN QUERY
    SELECT u.id, u.email::text, COALESCE(p.full_name, ''), p.college_id,
           COALESCE(r.role, 'student'::public.app_role), p.department_id,
           u.created_at, u.last_sign_in_at
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    LEFT JOIN public.user_roles r ON r.user_id = u.id
    ORDER BY u.created_at DESC;
END; $$;
REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

-- Admins manage the faculty allowlist from the UI.
CREATE OR REPLACE FUNCTION public.admin_faculty_allowlist(add_email TEXT DEFAULT NULL, remove_email TEXT DEFAULT NULL)
RETURNS SETOF TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can manage the faculty allowlist';
  END IF;
  IF add_email IS NOT NULL AND length(trim(add_email)) > 0 THEN
    INSERT INTO public.faculty_emails (email) VALUES (lower(trim(add_email))) ON CONFLICT DO NOTHING;
  END IF;
  IF remove_email IS NOT NULL THEN
    DELETE FROM public.faculty_emails WHERE lower(email) = lower(trim(remove_email));
  END IF;
  RETURN QUERY SELECT email FROM public.faculty_emails ORDER BY email;
END; $$;
REVOKE ALL ON FUNCTION public.admin_faculty_allowlist(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_faculty_allowlist(TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. Schedule (calendar)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schedule_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  kind TEXT NOT NULL DEFAULT 'lab_session'
    CHECK (kind IN ('lab_session', 'meeting', 'review', 'deadline')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  location TEXT,
  lab_id UUID REFERENCES public.labs ON DELETE SET NULL,
  notes TEXT,
  series_id UUID,
  created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS schedule_slots_time_idx ON public.schedule_slots (starts_at);
CREATE INDEX IF NOT EXISTS schedule_slots_project_idx ON public.schedule_slots (project_id);
ALTER TABLE public.schedule_slots ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_slots TO authenticated;
GRANT ALL ON public.schedule_slots TO service_role;

CREATE OR REPLACE FUNCTION public.can_manage_project(_project UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin')
      OR EXISTS (SELECT 1 FROM public.projects p
                 WHERE p.id = _project
                   AND (p.faculty_id = auth.uid() OR p.co_supervisor_id = auth.uid()));
$$;

DROP POLICY IF EXISTS "slots_select" ON public.schedule_slots;
CREATE POLICY "slots_select" ON public.schedule_slots FOR SELECT TO authenticated
  USING (
    public.is_staff(auth.uid())
    OR EXISTS (SELECT 1 FROM public.project_members m
               WHERE m.project_id = schedule_slots.project_id AND m.student_id = auth.uid())
  );
DROP POLICY IF EXISTS "slots_write" ON public.schedule_slots;
CREATE POLICY "slots_write" ON public.schedule_slots FOR ALL TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

-- -----------------------------------------------------------------------------
-- 8. Audit log
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id UUID,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON public.audit_log (at DESC);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_log FROM anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
DROP POLICY IF EXISTS "audit_admin_read" ON public.audit_log;
CREATE POLICY "audit_admin_read" ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.audit_trigger() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row JSONB := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  _old JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  _action TEXT := lower(TG_OP);
  _id TEXT := COALESCE(_row->>'id', _row->>'user_id');
  _details JSONB := '{}';
BEGIN
  IF TG_TABLE_NAME = 'work_sessions' THEN
    -- only status transitions matter; skip timer noise
    IF TG_OP = 'UPDATE' THEN
      IF (_old->>'status') IS NOT DISTINCT FROM (_row->>'status') THEN RETURN NULL; END IF;
    END IF;
    _action := CASE WHEN TG_OP = 'INSERT' THEN 'check_in'
                    WHEN TG_OP = 'DELETE' THEN 'delete'
                    WHEN _row->>'status' = 'pending' THEN 'check_out'
                    WHEN _row->>'status' = 'approved' THEN 'verify'
                    WHEN _row->>'status' = 'rejected' THEN 'return'
                    ELSE 'update' END;
    _details := jsonb_build_object('student_id', _row->>'student_id', 'project_id', _row->>'project_id',
                                   'minutes', _row->'duration_minutes', 'remarks', _row->>'remarks');
  ELSIF TG_TABLE_NAME = 'user_roles' THEN
    _action := 'role_change';
    _id := _row->>'user_id';
    _details := jsonb_build_object('from', _old->>'role', 'to', _row->>'role');
  ELSIF TG_TABLE_NAME = 'project_members' THEN
    _action := CASE WHEN TG_OP = 'INSERT' THEN 'join' ELSE 'leave' END;
    _details := jsonb_build_object('project_id', _row->>'project_id', 'student_id', _row->>'student_id');
  ELSIF TG_TABLE_NAME = 'submissions' THEN
    IF TG_OP = 'UPDATE' THEN
      IF (_old->>'status') IS NOT DISTINCT FROM (_row->>'status') THEN RETURN NULL; END IF;
    END IF;
    _details := jsonb_build_object('file', _row->>'file_name', 'status', _row->>'status');
  ELSE
    _details := jsonb_build_object('name', COALESCE(_row->>'title', _row->>'name'));
    IF TG_OP = 'UPDATE' THEN
      _details := _details || jsonb_build_object('changed',
        (SELECT jsonb_agg(k) FROM jsonb_object_keys(_row) k
         WHERE k NOT IN ('updated_at') AND _row->k IS DISTINCT FROM _old->k));
    END IF;
  END IF;

  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, details)
  VALUES (auth.uid(), _action, TG_TABLE_NAME, _id, _details);
  RETURN NULL;
END; $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_sessions','user_roles','projects','project_members','submissions',
                           'departments','labs','institution_settings','schedule_slots']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger()', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 9. Notifications
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications (user_id, created_at DESC);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT, DELETE ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
DROP POLICY IF EXISTS "notif_own_select" ON public.notifications;
CREATE POLICY "notif_own_select" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "notif_own_update" ON public.notifications;
CREATE POLICY "notif_own_update" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "notif_own_delete" ON public.notifications;
CREATE POLICY "notif_own_delete" ON public.notifications FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.notify(_user UUID, _kind TEXT, _title TEXT, _body TEXT, _link TEXT)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  SELECT _user, _kind, _title, _body, _link WHERE _user IS NOT NULL AND _user IS DISTINCT FROM auth.uid();
$$;
REVOKE ALL ON FUNCTION public.notify(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_work_sessions() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p public.projects%ROWTYPE; _who TEXT;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NULL; END IF;
  SELECT * INTO _p FROM public.projects WHERE id = NEW.project_id;
  IF NEW.status = 'pending' THEN
    SELECT full_name INTO _who FROM public.profiles WHERE id = NEW.student_id;
    PERFORM public.notify(_p.faculty_id, 'session_submitted',
      COALESCE(NULLIF(_who, ''), 'A student') || ' submitted a session',
      _p.title || ', ' || COALESCE(NEW.duration_minutes, 0) || ' min', '/approvals');
    PERFORM public.notify(_p.co_supervisor_id, 'session_submitted',
      COALESCE(NULLIF(_who, ''), 'A student') || ' submitted a session',
      _p.title || ', ' || COALESCE(NEW.duration_minutes, 0) || ' min', '/approvals');
  ELSIF NEW.status IN ('approved', 'rejected') THEN
    PERFORM public.notify(NEW.student_id, 'session_' || NEW.status,
      CASE WHEN NEW.status = 'approved' THEN 'Session verified' ELSE 'Session returned' END,
      _p.title || COALESCE(': ' || NEW.remarks, ''), '/projects/' || _p.id);
  END IF;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_ws ON public.work_sessions;
CREATE TRIGGER trg_notify_ws AFTER UPDATE ON public.work_sessions
  FOR EACH ROW EXECUTE FUNCTION public.notify_work_sessions();

CREATE OR REPLACE FUNCTION public.notify_schedule() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _title TEXT;
BEGIN
  -- one notification per recurring series, not per occurrence
  IF NEW.series_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.schedule_slots WHERE series_id = NEW.series_id AND id <> NEW.id) THEN
    RETURN NULL;
  END IF;
  SELECT title INTO _title FROM public.projects WHERE id = NEW.project_id;
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  SELECT m.student_id, 'schedule', 'New ' || replace(NEW.kind, '_', ' ') || ': ' || NEW.title,
         _title || ', ' || to_char(NEW.starts_at AT TIME ZONE
           (SELECT timezone FROM public.institution_settings LIMIT 1), 'Dy DD Mon, HH24:MI'),
         '/calendar'
  FROM public.project_members m WHERE m.project_id = NEW.project_id;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_schedule ON public.schedule_slots;
CREATE TRIGGER trg_notify_schedule AFTER INSERT ON public.schedule_slots
  FOR EACH ROW EXECUTE FUNCTION public.notify_schedule();

CREATE OR REPLACE FUNCTION public.notify_role_change() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role THEN
    PERFORM public.notify(NEW.user_id, 'role', 'Your role is now ' || NEW.role,
      'Sign out and back in through the ' || NEW.role || ' portal.', '/profile');
  END IF;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_role ON public.user_roles;
CREATE TRIGGER trg_notify_role AFTER UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.notify_role_change();

-- -----------------------------------------------------------------------------
-- 10. Attendance recommendation engine
--   For each (student, event): verified vs required hours, how far through the
--   term we are, and a recommendation:
--     eligible  – verified >= required * min_attendance_pct
--     on_track  – verified >= 90% of the hours expected by today
--     at_risk   – verified >= 60% of expected
--     behind    – below that
--   Term = event start/end dates, else semester dates from settings.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attendance_recommendations(p_project UUID DEFAULT NULL)
RETURNS TABLE (
  student_id UUID, project_id UUID, verified_minutes NUMERIC, pending_minutes NUMERIC,
  required_hours NUMERIC, progress_pct NUMERIC, expected_pct NUMERIC,
  recommendation TEXT, reason TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE _s public.institution_settings%ROWTYPE; _staff BOOLEAN := public.is_staff(auth.uid());
BEGIN
  SELECT * INTO _s FROM public.institution_settings LIMIT 1;
  RETURN QUERY
  WITH base AS (
    SELECT m.student_id AS sid, p.id AS pid, p.required_hours AS req,
           COALESCE(p.start_date, _s.semester_start) AS t0,
           COALESCE(p.end_date, _s.semester_end) AS t1,
           COALESCE(SUM(w.duration_minutes) FILTER (WHERE w.status = 'approved'), 0)::numeric AS vmin,
           COALESCE(SUM(w.duration_minutes) FILTER (WHERE w.status = 'pending'), 0)::numeric AS pmin
    FROM public.project_members m
    JOIN public.projects p ON p.id = m.project_id
    LEFT JOIN public.work_sessions w ON w.project_id = p.id AND w.student_id = m.student_id
    WHERE (p_project IS NULL OR p.id = p_project)
      AND (_staff OR m.student_id = auth.uid())
    GROUP BY m.student_id, p.id
  ), calc AS (
    SELECT b.*,
      CASE WHEN b.req > 0 THEN round(b.vmin / (b.req * 60) * 100, 1) ELSE 100 END AS prog,
      CASE WHEN b.t0 IS NULL OR b.t1 IS NULL OR b.t1 <= b.t0 THEN NULL
           ELSE round(LEAST(1, GREATEST(0, (current_date - b.t0)::numeric / (b.t1 - b.t0))) * 100, 1)
      END AS exp
    FROM base b
  )
  SELECT c.sid, c.pid, c.vmin, c.pmin, c.req, c.prog, c.exp,
    CASE
      WHEN c.prog >= _s.min_attendance_pct THEN 'eligible'
      WHEN c.exp IS NULL OR c.exp = 0 THEN CASE WHEN c.prog > 0 THEN 'on_track' ELSE 'at_risk' END
      WHEN c.prog >= c.exp * 0.9 THEN 'on_track'
      WHEN c.prog >= c.exp * 0.6 THEN 'at_risk'
      ELSE 'behind'
    END,
    CASE
      WHEN c.prog >= _s.min_attendance_pct THEN
        'Meets the ' || _s.min_attendance_pct || '% requirement'
      WHEN c.exp IS NULL THEN
        round(c.vmin / 60, 1) || 'h of ' || c.req || 'h verified; set term dates for pace tracking'
      ELSE
        round(c.vmin / 60, 1) || 'h verified, ' || round(c.req * c.exp / 100, 1) || 'h expected by today'
    END
  FROM calc c;
END; $$;
REVOKE ALL ON FUNCTION public.attendance_recommendations(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_recommendations(UUID) TO authenticated;
