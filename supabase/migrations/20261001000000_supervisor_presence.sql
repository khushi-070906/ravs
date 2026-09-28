-- =============================================================================
-- Supervisor presence confirmation
--
-- A supervisor physically in the lab taps "Present" next to a student in the
-- "In the lab now" roster. The session is stamped with who confirmed it and
-- when. It's the strongest presence evidence RAVS has: GPS and codes can be
-- relayed, a supervisor's eyes can't. Confirmation is only possible while the
-- session is running, and can be undone until check-out.
-- =============================================================================

ALTER TABLE public.work_sessions
  ADD COLUMN IF NOT EXISTS present_confirmed_by UUID REFERENCES auth.users ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS present_confirmed_at TIMESTAMPTZ;

-- Guard: the confirmation columns are immutable outside confirm_presence()
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
    NEW.correction_check_out_at := NULL;
    NEW.correction_reason := NULL;
    NEW.correction_status := NULL;
    NEW.correction_requested_at := NULL;
    NEW.correction_resolved_by := NULL;
    NEW.present_confirmed_by := NULL;
    NEW.present_confirmed_at := NULL;
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
  -- time corrections only change through request/resolve_time_correction()
  NEW.correction_check_out_at := OLD.correction_check_out_at;
  NEW.correction_reason := OLD.correction_reason;
  NEW.correction_status := OLD.correction_status;
  NEW.correction_requested_at := OLD.correction_requested_at;
  NEW.correction_resolved_by := OLD.correction_resolved_by;
  -- supervisor presence confirmation only changes through confirm_presence()
  NEW.present_confirmed_by := OLD.present_confirmed_by;
  NEW.present_confirmed_at := OLD.present_confirmed_at;

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
      IF OLD.correction_status = 'pending' THEN
        RAISE EXCEPTION 'Accept or decline the student''s time correction first';
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
-- confirm_presence(session, present): faculty / event supervisors
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_presence(p_session UUID, p_present BOOLEAN DEFAULT true)
RETURNS public.work_sessions
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s public.work_sessions; _row public.work_sessions;
BEGIN
  SELECT * INTO _s FROM public.work_sessions WHERE id = p_session;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF NOT (public.has_role(auth.uid(), 'faculty') OR public.can_manage_project(_s.project_id)) THEN
    RAISE EXCEPTION 'Only faculty can confirm presence';
  END IF;
  IF _s.student_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot confirm your own presence';
  END IF;
  IF _s.status <> 'active' THEN
    RAISE EXCEPTION 'Presence can only be confirmed while the session is running';
  END IF;

  PERFORM set_config('ravs.system', 'on', true);
  UPDATE public.work_sessions
     SET present_confirmed_by = CASE WHEN p_present THEN auth.uid() END,
         present_confirmed_at = CASE WHEN p_present THEN now() END
   WHERE id = p_session
   RETURNING * INTO _row;
  PERFORM set_config('ravs.system', '', true);
  RETURN _row;
END; $$;
REVOKE ALL ON FUNCTION public.confirm_presence(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_presence(UUID, BOOLEAN) TO authenticated;

-- Roll call: confirm everyone currently checked in to one event
CREATE OR REPLACE FUNCTION public.confirm_presence_all(p_project UUID)
RETURNS INT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE _n INT;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'faculty') OR public.can_manage_project(p_project)) THEN
    RAISE EXCEPTION 'Only faculty can confirm presence';
  END IF;
  PERFORM set_config('ravs.system', 'on', true);
  UPDATE public.work_sessions
     SET present_confirmed_by = auth.uid(), present_confirmed_at = now()
   WHERE project_id = p_project AND status = 'active'
     AND present_confirmed_at IS NULL AND student_id <> auth.uid();
  GET DIAGNOSTICS _n = ROW_COUNT;
  PERFORM set_config('ravs.system', '', true);
  RETURN _n;
END; $$;
REVOKE ALL ON FUNCTION public.confirm_presence_all(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_presence_all(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- live_sessions() now reports confirmation
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.live_sessions(UUID);
CREATE FUNCTION public.live_sessions(p_project UUID DEFAULT NULL)
RETURNS TABLE (
  session_id UUID, student_id UUID, student_name TEXT, student_college_id TEXT,
  project_id UUID, project_title TEXT, check_in_at TIMESTAMPTZ, check_in_method TEXT,
  check_in_distance_m DOUBLE PRECISION, flags TEXT[],
  present_confirmed_at TIMESTAMPTZ, present_confirmed_by_name TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.student_id, COALESCE(NULLIF(pr.full_name, ''), 'Unnamed member'), pr.college_id,
         w.project_id, p.title, w.check_in_at, w.check_in_method, w.check_in_distance_m, w.flags,
         w.present_confirmed_at, cf.full_name
  FROM public.work_sessions w
  JOIN public.projects p ON p.id = w.project_id
  LEFT JOIN public.profiles pr ON pr.id = w.student_id
  LEFT JOIN public.profiles cf ON cf.id = w.present_confirmed_by
  WHERE w.status = 'active'
    AND (p_project IS NULL OR w.project_id = p_project)
    AND (public.is_staff(auth.uid())
         OR p.faculty_id = auth.uid() OR p.co_supervisor_id = auth.uid())
  ORDER BY w.check_in_at;
$$;
REVOKE ALL ON FUNCTION public.live_sessions(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_sessions(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
