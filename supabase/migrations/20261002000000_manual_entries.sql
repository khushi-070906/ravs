-- =============================================================================
-- Manual time entries
--
-- A student can report hours without running the timer ("I worked 2h on
-- Tuesday, please verify"). The entry lands in the review queue as a pending
-- session, flagged manual_entry + no_code, and names the supervisor the
-- student worked with. It is verified or returned like any other session.
-- The student can withdraw it while it is still pending.
-- =============================================================================

ALTER TABLE public.work_sessions
  ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'timer'
    CHECK (entry_type IN ('timer', 'manual')),
  ADD COLUMN IF NOT EXISTS claimed_supervisor_id UUID REFERENCES auth.users ON DELETE SET NULL;

-- Guard (replaces 20261001000000 version): entry_type / claimed_supervisor_id
-- are immutable outside log_manual_session(), and a normal insert is a timer.
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
    -- a direct insert is always a timer session; manual entries only via log_manual_session()
    NEW.entry_type := 'timer';
    NEW.claimed_supervisor_id := NULL;
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
  -- how the time was recorded, and who the student named, never change after the fact
  NEW.entry_type := OLD.entry_type;
  NEW.claimed_supervisor_id := OLD.claimed_supervisor_id;

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
-- log_manual_session(): student reports time worked without the timer
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_manual_session(
  p_project UUID, p_supervisor UUID, p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_summary TEXT)
RETURNS public.work_sessions
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _p public.projects;
  _max INT;
  _tz TEXT;
  _start TIMESTAMPTZ := date_trunc('minute', p_start);
  _end TIMESTAMPTZ := date_trunc('minute', p_end);
  _mins INT;
  _summary TEXT := NULLIF(trim(COALESCE(p_summary, '')), '');
  _who TEXT;
  _row public.work_sessions;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sign in to log hours'; END IF;

  SELECT p.* INTO _p FROM public.projects p
   JOIN public.project_members pm ON pm.project_id = p.id AND pm.student_id = _uid
   WHERE p.id = p_project AND p.status <> 'archived';
  IF _p.id IS NULL THEN RAISE EXCEPTION 'Join this event before logging hours'; END IF;

  IF p_supervisor IS NULL OR p_supervisor = _uid
     OR p_supervisor NOT IN (_p.faculty_id, COALESCE(_p.co_supervisor_id, _p.faculty_id)) THEN
    RAISE EXCEPTION 'Pick a supervisor of this event';
  END IF;

  IF _summary IS NULL OR length(_summary) < 10 THEN
    RAISE EXCEPTION 'Describe the work you did (at least 10 characters)';
  END IF;

  SELECT max_session_minutes, timezone INTO _max, _tz FROM public.institution_settings LIMIT 1;
  _max := COALESCE(_max, 480);
  _tz := COALESCE(_tz, 'Asia/Kolkata');

  IF _start IS NULL OR _end IS NULL OR _end <= _start THEN
    RAISE EXCEPTION 'The end time must be after the start time';
  END IF;
  _mins := floor(extract(epoch FROM (_end - _start)) / 60)::int;
  IF _mins < 15 OR _mins > _max THEN
    RAISE EXCEPTION 'A manual entry must be between 15 min and % h', round(_max / 60.0, 1);
  END IF;
  IF _end > now() THEN
    RAISE EXCEPTION 'You can only log time that has already happened';
  END IF;
  IF (_start AT TIME ZONE _tz)::date < (now() AT TIME ZONE _tz)::date - 14 THEN
    RAISE EXCEPTION 'Manual entries can go back at most 14 days';
  END IF;

  -- serialise this student's entries so two submissions can't both pass the overlap check
  PERFORM pg_advisory_xact_lock(hashtextextended('ravs.manual_session:' || _uid::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.work_sessions w
     WHERE w.student_id = _uid
       AND tstzrange(w.check_in_at,
                     GREATEST(COALESCE(w.check_out_at, now()),
                              CASE WHEN w.correction_status = 'pending' THEN w.correction_check_out_at END),
                     '[)')
           && tstzrange(_start, _end, '[)')
  ) THEN
    RAISE EXCEPTION 'This time overlaps another of your sessions';
  END IF;

  PERFORM set_config('ravs.system', 'on', true);
  INSERT INTO public.work_sessions (
    project_id, student_id, status, check_in_at, check_out_at, summary, submitted_at,
    check_in_method, flags, entry_type, claimed_supervisor_id)
  VALUES (
    p_project, _uid, 'pending', _start, _end, left(_summary, 2000), now(),
    'manual', ARRAY['manual_entry', 'no_code'], 'manual', p_supervisor)
  RETURNING * INTO _row;
  PERFORM set_config('ravs.system', '', true);

  SELECT full_name INTO _who FROM public.profiles WHERE id = _uid;
  PERFORM public.notify(p_supervisor, 'manual_session_logged',
    COALESCE(NULLIF(_who, ''), 'A student') || ' logged hours manually',
    _p.title || ': ' || to_char(_start AT TIME ZONE _tz, 'DD Mon HH24:MI') || ', '
      || _row.duration_minutes || ' min — ' || left(_summary, 100),
    '/approvals');

  RETURN _row;
END; $$;
REVOKE ALL ON FUNCTION public.log_manual_session(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_manual_session(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;

-- Student withdraws their own manual entry while it is still awaiting review
CREATE OR REPLACE FUNCTION public.withdraw_manual_session(p_session UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.work_sessions
   WHERE id = p_session AND student_id = auth.uid()
     AND entry_type = 'manual' AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'No pending manual entry to withdraw'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.withdraw_manual_session(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_manual_session(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
