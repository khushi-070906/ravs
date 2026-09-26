-- =============================================================================
-- Presence verification, session integrity, leave, certificates, realtime
--
--   1. Rotating check-in code (QR + 6 digits), secret kept server-side
--   2. Lab geofences + location captured at check-in / check-out
--   3. Risk flags on work_sessions (flag, don't block)
--   4. Session cap + auto-close of forgotten sessions (pg_cron)
--   5. Leave requests, excused against scheduled lab sessions
--   6. Supervisor-issued attendance certificates + public verification
--   7. notifications -> supabase_realtime publication
--
-- Safe to run once on top of 20260927000000_institutional_core.sql.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- 0. Columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  ADD COLUMN IF NOT EXISTS radius_m INT NOT NULL DEFAULT 150 CHECK (radius_m BETWEEN 10 AND 5000);

ALTER TABLE public.institution_settings
  ADD COLUMN IF NOT EXISTS max_session_minutes INT NOT NULL DEFAULT 480
    CHECK (max_session_minutes BETWEEN 30 AND 1440);

ALTER TABLE public.work_sessions
  ADD COLUMN IF NOT EXISTS flags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS check_in_method TEXT NOT NULL DEFAULT 'manual'
    CHECK (check_in_method IN ('manual', 'code')),
  ADD COLUMN IF NOT EXISTS check_in_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS check_in_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS check_in_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS check_in_distance_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS check_out_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS check_out_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS check_out_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS check_out_distance_m DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS work_sessions_active_idx
  ON public.work_sessions (check_in_at) WHERE status = 'active';

-- -----------------------------------------------------------------------------
-- 1. Helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.distance_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
RETURNS float8 LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371000 * asin(LEAST(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))));
$$;

CREATE OR REPLACE FUNCTION public._add_flag(_flags TEXT[], _flag TEXT)
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _flag IS NULL OR _flag = ANY(COALESCE(_flags, '{}')) THEN COALESCE(_flags, '{}')
              ELSE COALESCE(_flags, '{}') || _flag END;
$$;

-- Geofence check for an event's lab. distance is NULL when the lab has no
-- geofence (nothing to compare against) or no position was given.
-- flag: 'off_site' | 'no_location' | NULL. GPS accuracy (capped at 500 m) is
-- given the benefit of the doubt.
CREATE OR REPLACE FUNCTION public._geofence(_project UUID, _lat float8, _lng float8, _acc float8,
                                            OUT distance float8, OUT flag TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _l public.labs%ROWTYPE;
BEGIN
  SELECT l.* INTO _l FROM public.projects p JOIN public.labs l ON l.id = p.lab_id WHERE p.id = _project;
  IF _l.id IS NULL OR _l.lat IS NULL OR _l.lng IS NULL THEN RETURN; END IF;
  IF _lat IS NULL OR _lng IS NULL THEN flag := 'no_location'; RETURN; END IF;
  distance := round(public.distance_m(_l.lat, _l.lng, _lat, _lng)::numeric, 1);
  IF distance - LEAST(COALESCE(_acc, 0), 500) > _l.radius_m THEN flag := 'off_site'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public._geofence(UUID, float8, float8, float8) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Rotating check-in code
--   A per-event secret never leaves the database. The code for each 30 s
--   window is HMAC(secret, event:window) reduced to 6 digits. The check-in
--   RPC accepts the current and two previous windows (~60-90 s of slack for
--   scanning and signing in).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.presence_secrets (
  project_id UUID PRIMARY KEY REFERENCES public.projects ON DELETE CASCADE,
  secret BYTEA NOT NULL DEFAULT extensions.gen_random_bytes(32),
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.presence_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.presence_secrets FROM anon, authenticated;
GRANT ALL ON public.presence_secrets TO service_role;
-- no policies: only SECURITY DEFINER functions below can read it

CREATE OR REPLACE FUNCTION public._presence_code(_project UUID, _window BIGINT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT lpad(((('x' || substr(encode(
           extensions.hmac(convert_to(_project::text || ':' || _window::text, 'UTF8'), s.secret, 'sha256'),
           'hex'), 1, 7))::bit(28)::int) % 1000000)::text, 6, '0')
  FROM public.presence_secrets s WHERE s.project_id = _project;
$$;
REVOKE ALL ON FUNCTION public._presence_code(UUID, BIGINT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.presence_code(p_project UUID)
RETURNS TABLE (code TEXT, expires_at TIMESTAMPTZ, period_s INT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE _w BIGINT := floor(extract(epoch FROM clock_timestamp()) / 30);
BEGIN
  IF NOT public.can_manage_project(p_project) THEN
    RAISE EXCEPTION 'Only this event''s supervisors can display its check-in code';
  END IF;
  INSERT INTO public.presence_secrets (project_id) VALUES (p_project) ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT public._presence_code(p_project, _w), to_timestamp((_w + 1) * 30), 30;
END; $$;
REVOKE ALL ON FUNCTION public.presence_code(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.presence_code(UUID) TO authenticated;

-- Invalidate every code ever shown (e.g. a photo of the screen is circulating).
CREATE OR REPLACE FUNCTION public.presence_rotate(p_project UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT public.can_manage_project(p_project) THEN
    RAISE EXCEPTION 'Only this event''s supervisors can rotate its check-in code';
  END IF;
  INSERT INTO public.presence_secrets (project_id, secret, rotated_at)
  VALUES (p_project, extensions.gen_random_bytes(32), now())
  ON CONFLICT (project_id) DO UPDATE SET secret = EXCLUDED.secret, rotated_at = now();
END; $$;
REVOKE ALL ON FUNCTION public.presence_rotate(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.presence_rotate(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Auto-close forgotten sessions
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_close_stale_sessions(_only_student UUID DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _max INT; _n INT;
BEGIN
  SELECT max_session_minutes INTO _max FROM public.institution_settings LIMIT 1;
  _max := COALESCE(_max, 480);
  PERFORM set_config('ravs.system', 'on', true);

  WITH closed AS (
    UPDATE public.work_sessions w
       SET status = 'pending',
           check_out_at = w.check_in_at + make_interval(mins => _max),
           submitted_at = now(),
           summary = COALESCE(NULLIF(trim(w.summary), ''),
                     'Auto-closed: no check-out within ' || round(_max / 60.0, 1) || 'h.'),
           flags = public._add_flag(w.flags, 'auto_closed')
     WHERE w.status = 'active'
       AND w.check_in_at < now() - make_interval(mins => _max)
       AND (_only_student IS NULL OR w.student_id = _only_student)
    RETURNING w.student_id, w.project_id
  ), notes AS (
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    SELECT c.student_id, 'session_auto_closed', 'Session auto-closed',
           p.title || ': you did not check out within ' || round(_max / 60.0, 1)
             || 'h, so it was closed at the limit and flagged for review.',
           '/attendance'
    FROM closed c JOIN public.projects p ON p.id = c.project_id
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM closed;

  PERFORM set_config('ravs.system', '', true);
  RETURN _n;
END; $$;
REVOKE ALL ON FUNCTION public.auto_close_stale_sessions(UUID) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. work_sessions guard (replaces 20260923000000 version)
--   Presence data only ever comes from the check_in / check_out RPCs via a
--   transaction-local setting, so clients cannot forge it. Direct inserts and
--   updates still work but get flagged.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.work_sessions_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _staff boolean;
  _ctx jsonb := NULLIF(current_setting('ravs.presence', true), '')::jsonb;
  _geo record;
  _max int;
BEGIN
  -- cron / service role / auto-close: trust the row, just derive duration
  IF _uid IS NULL OR current_setting('ravs.system', true) = 'on' THEN
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
    NEW.flags := '{}';
    NEW.check_out_lat := NULL;
    NEW.check_out_lng := NULL;
    NEW.check_out_accuracy_m := NULL;
    NEW.check_out_distance_m := NULL;

    NEW.check_in_method := CASE WHEN COALESCE((_ctx->>'code')::boolean, false) THEN 'code' ELSE 'manual' END;
    IF NEW.check_in_method <> 'code' THEN NEW.flags := public._add_flag(NEW.flags, 'no_code'); END IF;

    NEW.check_in_lat := (_ctx->>'lat')::float8;
    NEW.check_in_lng := (_ctx->>'lng')::float8;
    NEW.check_in_accuracy_m := (_ctx->>'acc')::float8;
    SELECT * INTO _geo FROM public._geofence(NEW.project_id, NEW.check_in_lat, NEW.check_in_lng, NEW.check_in_accuracy_m);
    NEW.check_in_distance_m := _geo.distance;
    IF _geo.flag IS NOT NULL THEN NEW.flags := public._add_flag(NEW.flags, _geo.flag || '_in'); END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: identity, timing and presence columns are immutable for everyone.
  NEW.id := OLD.id;
  NEW.student_id := OLD.student_id;
  NEW.project_id := OLD.project_id;
  NEW.check_in_at := OLD.check_in_at;
  NEW.created_at := OLD.created_at;
  NEW.flags := OLD.flags;
  NEW.check_in_method := OLD.check_in_method;
  NEW.check_in_lat := OLD.check_in_lat;
  NEW.check_in_lng := OLD.check_in_lng;
  NEW.check_in_accuracy_m := OLD.check_in_accuracy_m;
  NEW.check_in_distance_m := OLD.check_in_distance_m;
  NEW.check_out_lat := OLD.check_out_lat;
  NEW.check_out_lng := OLD.check_out_lng;
  NEW.check_out_accuracy_m := OLD.check_out_accuracy_m;
  NEW.check_out_distance_m := OLD.check_out_distance_m;

  _staff := public.is_staff(_uid);

  IF _uid = OLD.student_id THEN
    IF NEW.status NOT IN ('active', 'pending') THEN
      RAISE EXCEPTION 'You cannot review your own session';
    END IF;

    IF OLD.status = 'active' AND NEW.status = 'pending' THEN
      -- Check-out: server clock decides, capped at the institution limit.
      SELECT max_session_minutes INTO _max FROM public.institution_settings LIMIT 1;
      _max := COALESCE(_max, 480);
      NEW.check_out_at := now();
      IF NEW.check_out_at > OLD.check_in_at + make_interval(mins => _max) THEN
        NEW.check_out_at := OLD.check_in_at + make_interval(mins => _max);
        NEW.flags := public._add_flag(NEW.flags, 'too_long');
      END IF;
      NEW.submitted_at := now();

      NEW.check_out_lat := (_ctx->>'lat')::float8;
      NEW.check_out_lng := (_ctx->>'lng')::float8;
      NEW.check_out_accuracy_m := (_ctx->>'acc')::float8;
      SELECT * INTO _geo FROM public._geofence(OLD.project_id, NEW.check_out_lat, NEW.check_out_lng, NEW.check_out_accuracy_m);
      NEW.check_out_distance_m := _geo.distance;
      IF _geo.flag IS NOT NULL THEN NEW.flags := public._add_flag(NEW.flags, _geo.flag || '_out'); END IF;
    ELSIF OLD.status = 'rejected' AND NEW.status = 'pending' THEN
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

-- -----------------------------------------------------------------------------
-- 5. Check-in / check-out RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_in(
  p_project UUID, p_notes TEXT DEFAULT NULL, p_code TEXT DEFAULT NULL,
  p_lat float8 DEFAULT NULL, p_lng float8 DEFAULT NULL, p_accuracy float8 DEFAULT NULL)
RETURNS public.work_sessions
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _w BIGINT := floor(extract(epoch FROM clock_timestamp()) / 30);
  _code TEXT := NULLIF(regexp_replace(COALESCE(p_code, ''), '\D', '', 'g'), '');
  _ok BOOLEAN := false;
  _row public.work_sessions;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sign in to check in'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.project_members pm JOIN public.projects p ON p.id = pm.project_id
    WHERE pm.project_id = p_project AND pm.student_id = _uid AND p.status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'Join this event before checking in';
  END IF;

  -- a forgotten session from yesterday would otherwise block this check-in
  PERFORM public.auto_close_stale_sessions(_uid);

  IF _code IS NOT NULL THEN
    _ok := _code IN (public._presence_code(p_project, _w),
                     public._presence_code(p_project, _w - 1),
                     public._presence_code(p_project, _w - 2));
    IF NOT _ok THEN
      RAISE EXCEPTION 'That check-in code has expired or is for another event. Use the code on the lab screen now.';
    END IF;
  END IF;

  IF p_lat IS NOT NULL AND (p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180) THEN
    p_lat := NULL; p_lng := NULL;
  END IF;

  PERFORM set_config('ravs.presence',
    jsonb_build_object('code', _ok, 'lat', p_lat, 'lng', p_lng, 'acc', p_accuracy)::text, true);
  INSERT INTO public.work_sessions (project_id, student_id, notes)
  VALUES (p_project, _uid, NULLIF(trim(COALESCE(p_notes, '')), ''))
  RETURNING * INTO _row;
  PERFORM set_config('ravs.presence', '', true);
  RETURN _row;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'You already have a session running. Check out of it first.';
END; $$;
REVOKE ALL ON FUNCTION public.check_in(UUID, TEXT, TEXT, float8, float8, float8) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in(UUID, TEXT, TEXT, float8, float8, float8) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_out(
  p_session UUID, p_summary TEXT,
  p_lat float8 DEFAULT NULL, p_lng float8 DEFAULT NULL, p_accuracy float8 DEFAULT NULL)
RETURNS public.work_sessions
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.work_sessions;
BEGIN
  IF NULLIF(trim(COALESCE(p_summary, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Add a work summary before submitting';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_sessions
                 WHERE id = p_session AND student_id = auth.uid() AND status = 'active') THEN
    RAISE EXCEPTION 'No running session to check out of';
  END IF;
  PERFORM set_config('ravs.presence',
    jsonb_build_object('lat', p_lat, 'lng', p_lng, 'acc', p_accuracy)::text, true);
  UPDATE public.work_sessions SET status = 'pending', summary = left(trim(p_summary), 2000)
  WHERE id = p_session RETURNING * INTO _row;
  PERFORM set_config('ravs.presence', '', true);
  RETURN _row;
END; $$;
REVOKE ALL ON FUNCTION public.check_out(UUID, TEXT, float8, float8, float8) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_out(UUID, TEXT, float8, float8, float8) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. Schedule the auto-close job (every 10 min). If pg_cron isn't enabled the
--    migration still succeeds; check_in() closes the student's own stale
--    session as a fallback. Enable pg_cron in Dashboard -> Database ->
--    Extensions, then re-run this block.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ravs-auto-close';
  PERFORM cron.schedule('ravs-auto-close', '*/10 * * * *', 'SELECT public.auto_close_stale_sessions()');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available (%). Stale sessions will close on the student''s next check-in.', SQLERRM;
END $$;

-- -----------------------------------------------------------------------------
-- 7. Leave requests
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects ON DELETE CASCADE,   -- NULL = all my events
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  status public.submission_status NOT NULL DEFAULT 'pending',
  remarks TEXT,
  reviewed_by UUID REFERENCES auth.users ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on AND ends_on - starts_on <= 60)
);
CREATE INDEX IF NOT EXISTS leave_requests_student_idx ON public.leave_requests (student_id, starts_on);
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_requests TO authenticated;
GRANT ALL ON public.leave_requests TO service_role;

DROP POLICY IF EXISTS "leave_select" ON public.leave_requests;
CREATE POLICY "leave_select" ON public.leave_requests FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "leave_insert_own" ON public.leave_requests;
CREATE POLICY "leave_insert_own" ON public.leave_requests FOR INSERT TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND (project_id IS NULL OR EXISTS (SELECT 1 FROM public.project_members m
                                       WHERE m.project_id = leave_requests.project_id
                                         AND m.student_id = auth.uid()))
  );
DROP POLICY IF EXISTS "leave_review_staff" ON public.leave_requests;
CREATE POLICY "leave_review_staff" ON public.leave_requests FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()) AND student_id <> auth.uid())
  WITH CHECK (public.is_staff(auth.uid()) AND student_id <> auth.uid());
DROP POLICY IF EXISTS "leave_delete_own_pending" ON public.leave_requests;
CREATE POLICY "leave_delete_own_pending" ON public.leave_requests FOR DELETE TO authenticated
  USING (student_id = auth.uid() AND status = 'pending');

CREATE OR REPLACE FUNCTION public.leave_requests_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.remarks := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  -- reviewers may change only the decision and remark
  NEW.student_id := OLD.student_id;
  NEW.project_id := OLD.project_id;
  NEW.starts_on := OLD.starts_on;
  NEW.ends_on := OLD.ends_on;
  NEW.reason := OLD.reason;
  NEW.created_at := OLD.created_at;
  IF NEW.status = 'rejected' AND NULLIF(trim(COALESCE(NEW.remarks, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Add a remark when declining leave';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.remarks IS DISTINCT FROM OLD.remarks THEN
    NEW.reviewed_by := auth.uid();
    NEW.reviewed_at := now();
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.leave_requests_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_leave_guard ON public.leave_requests;
CREATE TRIGGER trg_leave_guard BEFORE INSERT OR UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.leave_requests_guard();

CREATE OR REPLACE FUNCTION public.notify_leave() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _who TEXT; _span TEXT;
BEGIN
  _span := to_char(NEW.starts_on, 'DD Mon')
           || CASE WHEN NEW.ends_on > NEW.starts_on THEN ' – ' || to_char(NEW.ends_on, 'DD Mon') ELSE '' END;
  IF TG_OP = 'INSERT' THEN
    SELECT full_name INTO _who FROM public.profiles WHERE id = NEW.student_id;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    SELECT DISTINCT sup, 'leave_requested',
           COALESCE(NULLIF(_who, ''), 'A student') || ' requested leave', _span || ': ' || left(NEW.reason, 120),
           '/approvals'
    FROM public.projects p
    CROSS JOIN LATERAL (VALUES (p.faculty_id), (p.co_supervisor_id)) v(sup)
    WHERE sup IS NOT NULL
      AND (p.id = NEW.project_id
           OR (NEW.project_id IS NULL AND EXISTS (SELECT 1 FROM public.project_members m
                                                  WHERE m.project_id = p.id AND m.student_id = NEW.student_id)));
  ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('approved', 'rejected') THEN
    PERFORM public.notify(NEW.student_id, 'leave_' || NEW.status,
      CASE WHEN NEW.status = 'approved' THEN 'Leave approved' ELSE 'Leave declined' END,
      _span || COALESCE(': ' || NEW.remarks, ''), '/attendance');
  END IF;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_leave ON public.leave_requests;
CREATE TRIGGER trg_notify_leave AFTER INSERT OR UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_leave();

DROP TRIGGER IF EXISTS trg_audit ON public.leave_requests;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- -----------------------------------------------------------------------------
-- 8. Attendance engine, now leave-aware
--   Scheduled lab sessions that fall on approved-leave days are excused: their
--   hours come off the event's requirement for that student.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.excused_minutes(_student UUID, _project UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(extract(epoch FROM (s.ends_at - s.starts_at)) / 60), 0)::numeric
  FROM public.schedule_slots s
  WHERE s.project_id = _project
    AND s.kind = 'lab_session'
    AND EXISTS (
      SELECT 1 FROM public.leave_requests lr
      WHERE lr.student_id = _student
        AND lr.status = 'approved'
        AND (lr.project_id IS NULL OR lr.project_id = _project)
        AND (s.starts_at AT TIME ZONE COALESCE((SELECT timezone FROM public.institution_settings LIMIT 1), 'Asia/Kolkata'))::date
            BETWEEN lr.starts_on AND lr.ends_on);
$$;
REVOKE ALL ON FUNCTION public.excused_minutes(UUID, UUID) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.attendance_recommendations(UUID);
CREATE FUNCTION public.attendance_recommendations(p_project UUID DEFAULT NULL)
RETURNS TABLE (
  student_id UUID, project_id UUID, verified_minutes NUMERIC, pending_minutes NUMERIC,
  required_hours NUMERIC, base_required_hours NUMERIC, excused_minutes NUMERIC,
  progress_pct NUMERIC, expected_pct NUMERIC, recommendation TEXT, reason TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE _s public.institution_settings%ROWTYPE; _staff BOOLEAN := public.is_staff(auth.uid());
BEGIN
  SELECT * INTO _s FROM public.institution_settings LIMIT 1;
  RETURN QUERY
  WITH base AS (
    SELECT m.student_id AS sid, p.id AS pid, p.required_hours::numeric AS req0,
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
  ), ex AS (
    SELECT b.*, public.excused_minutes(b.sid, b.pid) AS xmin FROM base b
  ), eff AS (
    SELECT e.*, round(GREATEST(0, e.req0 - e.xmin / 60), 1) AS req FROM ex e
  ), calc AS (
    SELECT f.*,
      CASE WHEN f.req > 0 THEN round(f.vmin / (f.req * 60) * 100, 1) ELSE 100 END AS prog,
      CASE WHEN f.t0 IS NULL OR f.t1 IS NULL OR f.t1 <= f.t0 THEN NULL
           ELSE round(LEAST(1, GREATEST(0, (current_date - f.t0)::numeric / (f.t1 - f.t0))) * 100, 1)
      END AS exp
    FROM eff f
  )
  SELECT c.sid, c.pid, c.vmin, c.pmin, c.req, c.req0, c.xmin, c.prog, c.exp,
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
    || CASE WHEN c.xmin > 0 THEN ' (' || round(c.xmin / 60, 1) || 'h excused on leave)' ELSE '' END
  FROM calc c;
END; $$;
REVOKE ALL ON FUNCTION public.attendance_recommendations(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_recommendations(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. Attendance certificates
--   Issued by the event's supervisor (or co-supervisor / admin). Figures are
--   computed server-side and frozen at issue time; the code is checked on the
--   public /verify page.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE DEFAULT upper(encode(extensions.gen_random_bytes(6), 'hex')),
  student_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  student_college_id TEXT,
  project_title TEXT NOT NULL,
  institution_name TEXT NOT NULL,
  term_label TEXT,
  period_start DATE,
  period_end DATE,
  verified_minutes INT NOT NULL,
  session_count INT NOT NULL,
  required_hours NUMERIC NOT NULL,
  excused_minutes INT NOT NULL DEFAULT 0,
  progress_pct NUMERIC NOT NULL,
  min_attendance_pct INT NOT NULL,
  issued_by UUID REFERENCES auth.users ON DELETE SET NULL,
  issued_by_name TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT
);
CREATE INDEX IF NOT EXISTS certificates_student_idx ON public.attendance_certificates (student_id, project_id);
ALTER TABLE public.attendance_certificates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_certificates FROM anon, authenticated;
GRANT SELECT ON public.attendance_certificates TO authenticated;
GRANT ALL ON public.attendance_certificates TO service_role;
DROP POLICY IF EXISTS "cert_select" ON public.attendance_certificates;
CREATE POLICY "cert_select" ON public.attendance_certificates FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.issue_certificate(p_student UUID, p_project UUID)
RETURNS public.attendance_certificates
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s public.institution_settings%ROWTYPE;
  _p public.projects%ROWTYPE;
  _t0 DATE; _t1 DATE; _vmin INT; _n INT; _xmin NUMERIC; _req NUMERIC; _pct NUMERIC;
  _row public.attendance_certificates;
BEGIN
  IF NOT public.can_manage_project(p_project) THEN
    RAISE EXCEPTION 'Only this event''s supervisors can issue certificates';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.project_members WHERE project_id = p_project AND student_id = p_student) THEN
    RAISE EXCEPTION 'This student is not enrolled in the event';
  END IF;
  SELECT * INTO _s FROM public.institution_settings LIMIT 1;
  SELECT * INTO _p FROM public.projects WHERE id = p_project;
  _t0 := COALESCE(_p.start_date, _s.semester_start);
  _t1 := COALESCE(_p.end_date, _s.semester_end);

  SELECT COALESCE(SUM(duration_minutes), 0), count(*) INTO _vmin, _n
  FROM public.work_sessions
  WHERE project_id = p_project AND student_id = p_student AND status = 'approved'
    AND (_t0 IS NULL OR (check_in_at AT TIME ZONE _s.timezone)::date >= _t0)
    AND (_t1 IS NULL OR (check_in_at AT TIME ZONE _s.timezone)::date <= _t1);

  _xmin := public.excused_minutes(p_student, p_project);
  _req := round(GREATEST(0, _p.required_hours - _xmin / 60), 1);
  _pct := CASE WHEN _req > 0 THEN round(_vmin / (_req * 60) * 100, 1) ELSE 100 END;

  -- one live certificate per student per event: supersede the previous one
  UPDATE public.attendance_certificates
     SET revoked_at = now(), revoked_reason = 'Superseded by a newer certificate'
   WHERE student_id = p_student AND project_id = p_project AND revoked_at IS NULL;

  INSERT INTO public.attendance_certificates (
    student_id, project_id, student_name, student_college_id, project_title, institution_name,
    term_label, period_start, period_end, verified_minutes, session_count, required_hours,
    excused_minutes, progress_pct, min_attendance_pct, issued_by, issued_by_name)
  SELECT p_student, p_project, COALESCE(NULLIF(sp.full_name, ''), 'Student'), sp.college_id, _p.title,
         _s.name, NULLIF(concat_ws(' ', _s.semester_label, _s.academic_year), ''),
         _t0, _t1, _vmin, _n, _req, round(_xmin)::int, _pct, _s.min_attendance_pct,
         auth.uid(), COALESCE(NULLIF(ip.full_name, ''), 'Supervisor')
  FROM (SELECT 1) one
  LEFT JOIN public.profiles sp ON sp.id = p_student
  LEFT JOIN public.profiles ip ON ip.id = auth.uid()
  RETURNING * INTO _row;

  PERFORM public.notify(p_student, 'certificate', 'Attendance certificate issued',
    _p.title || ': ' || round(_vmin / 60.0, 1) || 'h verified', '/projects/' || p_project);
  RETURN _row;
END; $$;
REVOKE ALL ON FUNCTION public.issue_certificate(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_certificate(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_certificate(p_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _pid UUID;
BEGIN
  SELECT project_id INTO _pid FROM public.attendance_certificates WHERE id = p_id;
  IF _pid IS NULL OR NOT public.can_manage_project(_pid) THEN
    RAISE EXCEPTION 'Only this event''s supervisors can revoke its certificates';
  END IF;
  UPDATE public.attendance_certificates
     SET revoked_at = now(), revoked_reason = NULLIF(trim(COALESCE(p_reason, '')), '')
   WHERE id = p_id AND revoked_at IS NULL;
END; $$;
REVOKE ALL ON FUNCTION public.revoke_certificate(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_certificate(UUID, TEXT) TO authenticated;

-- Public: anyone holding a certificate code can check it.
CREATE OR REPLACE FUNCTION public.verify_certificate(p_code TEXT)
RETURNS TABLE (
  code TEXT, student_name TEXT, student_college_id TEXT, project_title TEXT, institution_name TEXT,
  term_label TEXT, period_start DATE, period_end DATE, verified_minutes INT, session_count INT,
  required_hours NUMERIC, progress_pct NUMERIC, issued_by_name TEXT, issued_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ, revoked_reason TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.code, c.student_name, c.student_college_id, c.project_title, c.institution_name,
         c.term_label, c.period_start, c.period_end, c.verified_minutes, c.session_count,
         c.required_hours, c.progress_pct, c.issued_by_name, c.issued_at, c.revoked_at, c.revoked_reason
  FROM public.attendance_certificates c
  WHERE c.code = upper(regexp_replace(COALESCE(p_code, ''), '[^0-9A-Fa-f]', '', 'g'));
$$;
REVOKE ALL ON FUNCTION public.verify_certificate(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_certificate(TEXT) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 10. Realtime for the notification bell
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                       AND tablename = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
