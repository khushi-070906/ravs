-- =============================================================================
-- Presence hardening (on top of 20260928000000_presence_and_integrity.sql)
--
--   1. Throttle wrong check-in codes. A 6-digit code with 3 live windows could
--      be brute-forced by a script hammering check_in(); failures are now
--      recorded and a user is locked out after 8 wrong codes in 10 minutes.
--      (A RAISE would roll back the failure log, so a wrong code makes
--      check_in() return an empty row instead; the client treats that as
--      "code expired".)
--   2. Self-reported GPS accuracy no longer buys up to 500 m of slack. It is
--      capped at 150 m, and a fix worse than that is flagged 'low_accuracy'.
--   3. presence_code() also returns the server clock so the lab screen can
--      correct for a skewed kiosk clock (otherwise it can get stuck showing
--      an expired code).
--   4. Notes are length-capped server-side; check-out coordinates are range
--      checked like check-in ones.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Failure log
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.presence_failures (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects ON DELETE CASCADE,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS presence_failures_user_at_idx ON public.presence_failures (user_id, at);
ALTER TABLE public.presence_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.presence_failures FROM anon, authenticated;
GRANT ALL ON public.presence_failures TO service_role;
-- no policies: only SECURITY DEFINER functions touch it

-- -----------------------------------------------------------------------------
-- 2. Geofence with bounded accuracy slack
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._geofence(_project UUID, _lat float8, _lng float8, _acc float8,
                                            OUT distance float8, OUT flag TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _l public.labs%ROWTYPE;
  _slack float8 := LEAST(GREATEST(COALESCE(_acc, 0), 0), 150);
BEGIN
  SELECT l.* INTO _l FROM public.projects p JOIN public.labs l ON l.id = p.lab_id WHERE p.id = _project;
  IF _l.id IS NULL OR _l.lat IS NULL OR _l.lng IS NULL THEN RETURN; END IF;
  IF _lat IS NULL OR _lng IS NULL THEN flag := 'no_location'; RETURN; END IF;
  distance := round(public.distance_m(_l.lat, _l.lng, _lat, _lng)::numeric, 1);
  IF distance - _slack > _l.radius_m THEN
    flag := 'off_site';
  ELSIF COALESCE(_acc, 0) > 150 THEN
    flag := 'low_accuracy';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public._geofence(UUID, float8, float8, float8) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. presence_code with server clock
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.presence_code(UUID);
CREATE FUNCTION public.presence_code(p_project UUID)
RETURNS TABLE (code TEXT, expires_at TIMESTAMPTZ, period_s INT, server_now TIMESTAMPTZ)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _now TIMESTAMPTZ := clock_timestamp();
  _w BIGINT := floor(extract(epoch FROM _now) / 30);
BEGIN
  IF NOT public.can_manage_project(p_project) THEN
    RAISE EXCEPTION 'Only this event''s supervisors can display its check-in code';
  END IF;
  INSERT INTO public.presence_secrets (project_id) VALUES (p_project) ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT public._presence_code(p_project, _w), to_timestamp((_w + 1) * 30), 30, _now;
END; $$;
REVOKE ALL ON FUNCTION public.presence_code(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.presence_code(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. check_in with throttling
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
  _fails INT;
  _row public.work_sessions;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sign in to check in'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.project_members pm JOIN public.projects p ON p.id = pm.project_id
    WHERE pm.project_id = p_project AND pm.student_id = _uid AND p.status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'Join this event before checking in';
  END IF;

  IF _code IS NOT NULL THEN
    SELECT count(*) INTO _fails FROM public.presence_failures
     WHERE user_id = _uid AND at > now() - interval '10 minutes';
    IF _fails >= 8 THEN
      RAISE EXCEPTION 'Too many wrong codes. Wait 10 minutes, or ask your supervisor.';
    END IF;

    _ok := _code IN (public._presence_code(p_project, _w),
                     public._presence_code(p_project, _w - 1),
                     public._presence_code(p_project, _w - 2));
    IF NOT _ok THEN
      -- must return (not raise) so this row is committed
      DELETE FROM public.presence_failures WHERE user_id = _uid AND at < now() - interval '1 day';
      INSERT INTO public.presence_failures (user_id, project_id) VALUES (_uid, p_project);
      RETURN NULL;
    END IF;
  END IF;

  -- a forgotten session from yesterday would otherwise block this check-in
  PERFORM public.auto_close_stale_sessions(_uid);

  IF p_lat IS NOT NULL AND (p_lat NOT BETWEEN -90 AND 90 OR p_lng IS NULL OR p_lng NOT BETWEEN -180 AND 180) THEN
    p_lat := NULL; p_lng := NULL;
  END IF;

  PERFORM set_config('ravs.presence',
    jsonb_build_object('code', _ok, 'lat', p_lat, 'lng', p_lng, 'acc', p_accuracy)::text, true);
  INSERT INTO public.work_sessions (project_id, student_id, notes)
  VALUES (p_project, _uid, left(NULLIF(trim(COALESCE(p_notes, '')), ''), 500))
  RETURNING * INTO _row;
  PERFORM set_config('ravs.presence', '', true);
  RETURN _row;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'You already have a session running. Check out of it first.';
END; $$;
REVOKE ALL ON FUNCTION public.check_in(UUID, TEXT, TEXT, float8, float8, float8) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in(UUID, TEXT, TEXT, float8, float8, float8) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. check_out with coordinate validation
-- -----------------------------------------------------------------------------
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
  IF p_lat IS NOT NULL AND (p_lat NOT BETWEEN -90 AND 90 OR p_lng IS NULL OR p_lng NOT BETWEEN -180 AND 180) THEN
    p_lat := NULL; p_lng := NULL;
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

NOTIFY pgrst, 'reload schema';
