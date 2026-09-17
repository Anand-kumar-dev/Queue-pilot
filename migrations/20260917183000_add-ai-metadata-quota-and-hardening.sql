-- Queue Pilot AI metadata quota and production hardening.
-- This table stores only request timing/action metadata; prompts and generated
-- content are deliberately not retained.

CREATE TABLE IF NOT EXISTS public.ai_metadata_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (char_length(action) BETWEEN 1 AND 30),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_metadata_requests_user_requested_idx
  ON public.ai_metadata_requests (user_id, requested_at DESC);

ALTER TABLE public.ai_metadata_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_metadata_requests FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.ai_metadata_requests IS
  'Server-owned Queue Pilot AI usage ledger. Intentionally has no browser RLS policies.';
COMMENT ON TABLE public.youtube_channel_credentials IS
  'Server-owned encrypted YouTube credentials. Intentionally has no browser RLS policies.';
COMMENT ON TABLE public.youtube_oauth_states IS
  'Server-owned short-lived OAuth state. Intentionally has no browser RLS policies.';
COMMENT ON TABLE public.youtube_upload_jobs IS
  'Server-owned upload worker queue. Intentionally has no browser RLS policies.';

CREATE OR REPLACE FUNCTION public.consume_ai_metadata_quota(p_action TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_hour_count INTEGER;
  v_day_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_action IS NULL OR char_length(trim(p_action)) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'invalid AI action';
  END IF;

  -- Serialize quota checks for this user so simultaneous requests cannot race
  -- past the hourly/daily limits.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::TEXT, 8142026)
  );

  SELECT
    count(*) FILTER (WHERE requested_at >= pg_catalog.now() - interval '1 hour'),
    count(*) FILTER (WHERE requested_at >= pg_catalog.now() - interval '1 day')
  INTO v_hour_count, v_day_count
  FROM public.ai_metadata_requests
  WHERE user_id = v_user_id
    AND requested_at >= pg_catalog.now() - interval '1 day';

  IF v_hour_count >= 20 OR v_day_count >= 100 THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.ai_metadata_requests (user_id, action)
  VALUES (v_user_id, trim(p_action));
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_metadata_quota(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_ai_metadata_quota(TEXT) TO authenticated;

-- These functions intentionally cross RLS boundaries after checking auth.uid()
-- and record ownership. An empty search_path removes object-hijacking risk.
ALTER FUNCTION public.create_video_draft(
  UUID, JSONB, JSONB, TEXT, TEXT, TEXT[], TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ, TEXT
) SET search_path = '';
ALTER FUNCTION public.delete_video_draft(UUID) SET search_path = '';
ALTER FUNCTION public.enqueue_video_post(UUID) SET search_path = '';
ALTER FUNCTION public.retry_video_post(UUID) SET search_path = '';
ALTER FUNCTION public.cancel_queued_video_post(UUID) SET search_path = '';

CREATE INDEX IF NOT EXISTS youtube_upload_jobs_video_post_user_idx
  ON public.youtube_upload_jobs (video_post_id, user_id);
CREATE INDEX IF NOT EXISTS youtube_upload_jobs_user_id_idx
  ON public.youtube_upload_jobs (user_id);
CREATE INDEX IF NOT EXISTS video_posts_video_asset_id_idx
  ON public.video_posts (video_asset_id);
CREATE INDEX IF NOT EXISTS video_posts_thumbnail_asset_id_idx
  ON public.video_posts (thumbnail_asset_id);
CREATE INDEX IF NOT EXISTS video_post_events_video_post_user_idx
  ON public.video_post_events (video_post_id, user_id);
