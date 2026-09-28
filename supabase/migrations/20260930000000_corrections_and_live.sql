-- =============================================================================
-- Time corrections + live lab roster
--
--   1. Students can ask for a session's check-out time to be corrected (forgot
--      to check out, auto-closed at the cap, checked out by mistake). The
--      supervisor accepts or declines it from the review queue; a session with
--      an open correction can't be verified until it's resolved.
--   2. live_sessions(): who is checked in right now, for staff, with presence
--      evidence. Powers the "In the lab now" roster and the lab-screen count.
--   3. Auto-close notification now tells the student to request a correction.
-- =============================================================================

ALTER TABLE public.work_sessions
  ADD COLUMN IF NOT EXISTS correction_check_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS correction_reason TEXT,
  ADD COLUMN IF NOT EXISTS correction_status TEXT
    CHECK (correction_status IS NULL OR correction_status IN ('pending', 'accepted', 'declined')),
  ADD COLUMN IF NOT EXISTS correction_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS correction_resolved_by UUID REFERENCES auth.users ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS work_sessions_correction_idx
  ON public.work_sessions (correction_requested_at) WHERE correction_status = 'pending';

-- -----------------------------------------------------------------------------
-- 1. Guard: correction columns are immutable outside the RPCs, and a session
--    with an open correction can't be reviewed.
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
    NEW.correction_check_out_at := NULL;
    NEW.correction_reason := NULL;
    NEW.correction_status := NULL;
    NEW.correction_requested_at := NULL;
    NEW.correction_resolved_by := NULL;
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
-- 2. Student: request a correction
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_time_correction(
  p_session UUID, p_check_out_at TIMESTAMPTZ, p_reason TEXT)
RETURNS public.work_sessions
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s public.work_sessions;
  _max INT;
  _reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
  _who TEXT;
  _row public.work_sessions;
BEGIN
  SELECT * INTO _s FROM public.work_sessions WHERE id = p_session AND student_id = auth.uid();
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF _s.status NOT IN ('pending', 'rejected') THEN
    RAISE EXCEPTION 'Only sessions awaiting review or returned to you can be corrected';
  END IF;
  IF _s.correction_status = 'pending' THEN
    RAISE EXCEPTION 'A correction for this session is already waiting for your supervisor';
  END IF;
  IF _reason IS NULL OR length(_reason) < 5 THEN
    RAISE EXCEPTION 'Say briefly why the time is wrong';
  END IF;

  SELECT max_session_minutes INTO _max FROM public.institution_settings LIMIT 1;
  _max := COALESCE(_max, 480);
  IF p_check_out_at IS NULL
     OR p_check_out_at < _s.check_in_at + interval '1 minute'
     OR p_check_out_at > LEAST(now(), _s.check_in_at + make_interval(mins => _max)) THEN
    RAISE EXCEPTION 'The check-out time must be after check-in, within % h, and not in the future',
      round(_max / 60.0, 1);
  END IF;
  IF p_check_out_at = _s.check_out_at THEN
    RAISE EXCEPTION 'That is already the recorded check-out time';
  END IF;

  PERFORM set_config('ravs.system', 'on', true);
  UPDATE public.work_sessions
     SET correction_check_out_at = date_trunc('minute', p_check_out_at),
         correction_reason = left(_reason, 500),
         correction_status = 'pending',
         correction_requested_at = now(),
         correction_resolved_by = NULL,
         -- a returned session goes back into the queue with the correction
         status = 'pending',
         submitted_at = CASE WHEN status = 'rejected' THEN now() ELSE submitted_at END,
         reviewed_by = CASE WHEN status = 'rejected' THEN NULL ELSE reviewed_by END,
         reviewed_at = CASE WHEN status = 'rejected' THEN NULL ELSE reviewed_at END
   WHERE id = p_session
   RETURNING * INTO _row;
  PERFORM set_config('ravs.system', '', true);

  SELECT full_name INTO _who FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  SELECT DISTINCT sup, 'correction_requested',
         COALESCE(NULLIF(_who, ''), 'A student') || ' asked for a time correction',
         p.title || ': check-out ' || to_char(_row.correction_check_out_at AT TIME ZONE
           COALESCE((SELECT timezone FROM public.institution_settings LIMIT 1), 'Asia/Kolkata'), 'DD Mon HH24:MI')
           || ' — ' || left(_reason, 100),
         '/approvals'
  FROM public.projects p
  CROSS JOIN LATERAL (VALUES (p.faculty_id), (p.co_supervisor_id)) v(sup)
  WHERE p.id = _s.project_id AND sup IS NOT NULL AND sup <> auth.uid();

  RETURN _row;
END; $$;
REVOKE ALL ON FUNCTION public.request_time_correction(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_time_correction(UUID, TIMESTAMPTZ, TEXT) TO authenticated;

-- Student withdraws their own open request
CREATE OR REPLACE FUNCTION public.withdraw_time_correction(p_session UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('ravs.system', 'on', true);
  UPDATE public.work_sessions
     SET correction_check_out_at = NULL, correction_reason = NULL, correction_status = NULL,
         correction_requested_at = NULL, correction_resolved_by = NULL
   WHERE id = p_session AND student_id = auth.uid() AND correction_status = 'pending';
  PERFORM set_config('ravs.system', '', true);
  IF NOT FOUND THEN RAISE EXCEPTION 'No open correction on this session'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.withdraw_time_correction(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_time_correction(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Faculty: accept / decline
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_time_correction(
  p_session UUID, p_accept BOOLEAN, p_remarks TEXT DEFAULT NULL)
RETURNS public.work_sessions
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s public.work_sessions; _row public.work_sessions; _note TEXT := NULLIF(trim(COALESCE(p_remarks, '')), '');
BEGIN
  IF NOT public.has_role(auth.uid(), 'faculty') THEN
    RAISE EXCEPTION 'Only faculty can resolve time corrections';
  END IF;
  SELECT * INTO _s FROM public.work_sessions WHERE id = p_session;
  IF _s.id IS NULL OR _s.correction_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'No open correction on this session';
  END IF;
  IF _s.student_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot resolve your own correction';
  END IF;
  IF NOT p_accept AND _note IS NULL THEN
    RAISE EXCEPTION 'Add a remark when declining a correction';
  END IF;

  PERFORM set_config('ravs.system', 'on', true);
  UPDATE public.work_sessions
     SET correction_status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
         correction_resolved_by = auth.uid(),
         check_out_at = CASE WHEN p_accept THEN correction_check_out_at ELSE check_out_at END,
         flags = CASE WHEN p_accept THEN public._add_flag(flags, 'time_corrected') ELSE flags END,
         remarks = COALESCE(_note, remarks)
   WHERE id = p_session
   RETURNING * INTO _row;
  PERFORM set_config('ravs.system', '', true);

  PERFORM public.notify(_s.student_id, 'correction_' || CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
    CASE WHEN p_accept THEN 'Time correction accepted' ELSE 'Time correction declined' END,
    CASE WHEN p_accept THEN 'Session now counts ' || _row.duration_minutes || ' min.'
         ELSE COALESCE(_note, '') END,
    '/attendance');
  RETURN _row;
END; $$;
REVOKE ALL ON FUNCTION public.resolve_time_correction(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_time_correction(UUID, BOOLEAN, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Live roster
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.live_sessions(p_project UUID DEFAULT NULL)
RETURNS TABLE (
  session_id UUID, student_id UUID, student_name TEXT, student_college_id TEXT,
  project_id UUID, project_title TEXT, check_in_at TIMESTAMPTZ, check_in_method TEXT,
  check_in_distance_m DOUBLE PRECISION, flags TEXT[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.student_id, COALESCE(NULLIF(pr.full_name, ''), 'Unnamed member'), pr.college_id,
         w.project_id, p.title, w.check_in_at, w.check_in_method, w.check_in_distance_m, w.flags
  FROM public.work_sessions w
  JOIN public.projects p ON p.id = w.project_id
  LEFT JOIN public.profiles pr ON pr.id = w.student_id
  WHERE w.status = 'active'
    AND (p_project IS NULL OR w.project_id = p_project)
    AND (public.is_staff(auth.uid())
         OR p.faculty_id = auth.uid() OR p.co_supervisor_id = auth.uid())
  ORDER BY w.check_in_at;
$$;
REVOKE ALL ON FUNCTION public.live_sessions(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_sessions(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Auto-close message points at the correction flow
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
             || 'h, so it was closed at the limit and flagged. Open Attendance and use "Fix time" to give your real check-out time.',
           '/attendance'
    FROM closed c JOIN public.projects p ON p.id = c.project_id
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM closed;

  PERFORM set_config('ravs.system', '', true);
  RETURN _n;
END; $$;
REVOKE ALL ON FUNCTION public.auto_close_stale_sessions(UUID) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
