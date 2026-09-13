-- Queue ownership and state transitions for the server-owned YouTube upload
-- worker. Browser users can request an action only for their own releases;
-- the worker itself is the only component that advances transfer state.

ALTER TABLE public.video_posts
  DROP CONSTRAINT IF EXISTS video_posts_status_check;

ALTER TABLE public.video_posts
  ADD CONSTRAINT video_posts_status_check
  CHECK (status IN (
    'draft', 'queued', 'uploading', 'processing', 'ready', 'scheduled',
    'published', 'failed', 'cancelled'
  ));

CREATE OR REPLACE FUNCTION public.enqueue_video_post(p_video_post_id UUID)
RETURNS public.youtube_upload_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_post public.video_posts%ROWTYPE;
  v_asset public.media_assets%ROWTYPE;
  v_job public.youtube_upload_jobs%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT * INTO v_post
  FROM public.video_posts
  WHERE id = p_video_post_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'owned release not found';
  END IF;
  IF v_post.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft releases can enter the publishing queue';
  END IF;
  IF v_post.channel_id IS NULL OR v_post.video_asset_id IS NULL THEN
    RAISE EXCEPTION 'a destination channel and source video are required';
  END IF;
  IF v_post.made_for_kids IS NULL THEN
    RAISE EXCEPTION 'an audience selection is required';
  END IF;
  IF v_post.publish_at IS NOT NULL AND v_post.publish_at <= now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'scheduled releases must be at least five minutes in the future';
  END IF;

  PERFORM 1 FROM public.youtube_channels
  WHERE id = v_post.channel_id
    AND user_id = v_user_id
    AND connection_status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'an active owned YouTube channel is required';
  END IF;

  SELECT * INTO v_asset
  FROM public.media_assets
  WHERE id = v_post.video_asset_id
    AND user_id = v_user_id
    AND kind = 'video'
  FOR UPDATE;
  IF NOT FOUND OR v_asset.size_bytes <= 0 THEN
    RAISE EXCEPTION 'the source video is unavailable';
  END IF;

  UPDATE public.media_assets
  SET status = 'ready', failure_code = NULL
  WHERE id = v_asset.id;

  INSERT INTO public.youtube_upload_jobs (
    video_post_id, user_id, state, total_bytes, chunk_size_bytes, next_attempt_at
  ) VALUES (
    v_post.id, v_user_id, 'queued', v_asset.size_bytes, 8388608, now()
  )
  RETURNING * INTO v_job;

  UPDATE public.video_posts
  SET status = 'queued', queued_at = now(), progress_bytes = 0,
      last_error_code = NULL, last_error_message = NULL
  WHERE id = v_post.id;

  INSERT INTO public.video_post_events (video_post_id, user_id, event_type, detail)
  VALUES (v_post.id, v_user_id, 'queued', jsonb_build_object('job_id', v_job.id));

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_video_post(p_video_post_id UUID)
RETURNS public.youtube_upload_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_job public.youtube_upload_jobs%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT job.* INTO v_job
  FROM public.youtube_upload_jobs AS job
  JOIN public.video_posts AS post ON post.id = job.video_post_id
  WHERE post.id = p_video_post_id
    AND post.user_id = v_user_id
    AND post.status = 'failed'
    AND job.state = 'failed'
  FOR UPDATE OF job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'a failed owned release is required';
  END IF;

  UPDATE public.youtube_upload_jobs
  SET state = 'queued', next_attempt_at = now(), attempt_count = 0,
      last_http_status = NULL, last_error_code = NULL, last_error_detail = NULL,
      lease_token = NULL, lease_expires_at = NULL
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  UPDATE public.video_posts
  SET status = 'queued', last_error_code = NULL, last_error_message = NULL,
      queued_at = now()
  WHERE id = p_video_post_id;

  INSERT INTO public.video_post_events (video_post_id, user_id, event_type, detail)
  VALUES (p_video_post_id, v_user_id, 'retry_queued', jsonb_build_object('job_id', v_job.id));

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_queued_video_post(p_video_post_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  UPDATE public.youtube_upload_jobs AS job
  SET state = 'cancelled', lease_token = NULL, lease_expires_at = NULL
  FROM public.video_posts AS post
  WHERE job.video_post_id = post.id
    AND post.id = p_video_post_id
    AND post.user_id = v_user_id
    AND post.status = 'queued'
    AND job.state IN ('queued', 'retry_wait');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'only an owned queued release can be cancelled';
  END IF;

  UPDATE public.video_posts
  SET status = 'cancelled', completed_at = now()
  WHERE id = p_video_post_id AND user_id = v_user_id;

  INSERT INTO public.video_post_events (video_post_id, user_id, event_type)
  VALUES (p_video_post_id, v_user_id, 'cancelled');
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_youtube_upload_job(
  p_states TEXT[],
  p_lease_seconds INTEGER DEFAULT 240
)
RETURNS public.youtube_upload_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_job public.youtube_upload_jobs%ROWTYPE;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'lease duration is outside the allowed range';
  END IF;

  SELECT * INTO v_job
  FROM public.youtube_upload_jobs
  WHERE state = ANY(p_states)
    AND next_attempt_at <= now()
    AND (lease_expires_at IS NULL OR lease_expires_at < now())
  ORDER BY next_attempt_at ASC, created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.youtube_upload_jobs
  SET lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_video_post(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retry_video_post(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_queued_video_post(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_youtube_upload_job(TEXT[], INTEGER) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_video_post(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retry_video_post(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_queued_video_post(UUID) TO authenticated;
