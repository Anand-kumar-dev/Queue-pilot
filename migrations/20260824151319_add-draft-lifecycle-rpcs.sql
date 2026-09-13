-- Make draft creation atomic after private storage uploads and provide a
-- server-owned deletion path that also releases unreferenced asset records.

CREATE OR REPLACE FUNCTION public.youtube_tags_character_length(value TEXT[])
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(SUM(
    char_length(tag)
    + CASE WHEN tag ~ '\s' THEN 2 ELSE 0 END
    + CASE WHEN position > 1 THEN 1 ELSE 0 END
  ), 0)::INTEGER
  FROM unnest(value) WITH ORDINALITY AS entries(tag, position);
$$;

ALTER TABLE public.video_posts
  ADD CONSTRAINT video_posts_title_youtube_safe
    CHECK (char_length(trim(title)) BETWEEN 1 AND 100 AND title !~ '[<>]') NOT VALID,
  ADD CONSTRAINT video_posts_description_youtube_safe
    CHECK (octet_length(description) <= 5000 AND description !~ '[<>]') NOT VALID,
  ADD CONSTRAINT video_posts_tags_youtube_safe
    CHECK (
      public.youtube_tags_character_length(tags) <= 500
      AND array_position(tags, NULL) IS NULL
    ) NOT VALID;

CREATE OR REPLACE FUNCTION public.create_video_draft(
  p_channel_id UUID,
  p_video_asset JSONB,
  p_thumbnail_asset JSONB,
  p_title TEXT,
  p_description TEXT,
  p_tags TEXT[],
  p_target_privacy_status TEXT,
  p_made_for_kids BOOLEAN,
  p_contains_synthetic_media BOOLEAN,
  p_notify_subscribers BOOLEAN,
  p_publish_at TIMESTAMPTZ,
  p_schedule_timezone TEXT
)
RETURNS public.video_posts
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_video_asset_id UUID;
  v_thumbnail_asset_id UUID;
  v_video_size BIGINT;
  v_thumbnail_size BIGINT;
  v_post public.video_posts%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.youtube_channels AS channel
    WHERE channel.id = p_channel_id
      AND channel.user_id = v_user_id
      AND channel.connection_status = 'active'
  ) THEN
    RAISE EXCEPTION 'an active owned YouTube channel is required';
  END IF;

  IF p_video_asset IS NULL OR jsonb_typeof(p_video_asset) <> 'object' THEN
    RAISE EXCEPTION 'video asset metadata is required';
  END IF;

  v_video_asset_id := (p_video_asset ->> 'id')::UUID;
  v_video_size := (p_video_asset ->> 'size_bytes')::BIGINT;

  IF p_video_asset ->> 'bucket' <> 'video-uploads'
    OR p_video_asset ->> 'key' NOT LIKE v_user_id::TEXT || '/%'
    OR coalesce(p_video_asset ->> 'url', '') = ''
    OR coalesce(p_video_asset ->> 'original_filename', '') = ''
    OR coalesce(p_video_asset ->> 'mime_type', '') = ''
    OR v_video_size <= 0
    OR v_video_size > 209715200
  THEN
    RAISE EXCEPTION 'video asset metadata is invalid';
  END IF;

  IF p_thumbnail_asset IS NOT NULL AND jsonb_typeof(p_thumbnail_asset) <> 'null' THEN
    IF jsonb_typeof(p_thumbnail_asset) <> 'object' THEN
      RAISE EXCEPTION 'thumbnail asset metadata is invalid';
    END IF;

    v_thumbnail_asset_id := (p_thumbnail_asset ->> 'id')::UUID;
    v_thumbnail_size := (p_thumbnail_asset ->> 'size_bytes')::BIGINT;

    IF p_thumbnail_asset ->> 'bucket' <> 'video-thumbnails'
      OR p_thumbnail_asset ->> 'key' NOT LIKE v_user_id::TEXT || '/%'
      OR coalesce(p_thumbnail_asset ->> 'url', '') = ''
      OR coalesce(p_thumbnail_asset ->> 'original_filename', '') = ''
      OR p_thumbnail_asset ->> 'mime_type' NOT IN ('image/jpeg', 'image/png')
      OR v_thumbnail_size <= 0
      OR v_thumbnail_size > 2097152
    THEN
      RAISE EXCEPTION 'thumbnail asset metadata is invalid';
    END IF;
  END IF;

  IF p_publish_at IS NOT NULL AND p_publish_at <= now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'scheduled releases must be at least five minutes in the future';
  END IF;

  IF p_publish_at IS NOT NULL AND p_target_privacy_status <> 'public' THEN
    RAISE EXCEPTION 'scheduled releases must target public privacy';
  END IF;

  INSERT INTO public.media_assets (
    id,
    user_id,
    kind,
    bucket,
    key,
    url,
    original_filename,
    mime_type,
    size_bytes
  ) VALUES (
    v_video_asset_id,
    v_user_id,
    'video',
    p_video_asset ->> 'bucket',
    p_video_asset ->> 'key',
    p_video_asset ->> 'url',
    p_video_asset ->> 'original_filename',
    p_video_asset ->> 'mime_type',
    v_video_size
  );

  IF v_thumbnail_asset_id IS NOT NULL THEN
    INSERT INTO public.media_assets (
      id,
      user_id,
      kind,
      bucket,
      key,
      url,
      original_filename,
      mime_type,
      size_bytes
    ) VALUES (
      v_thumbnail_asset_id,
      v_user_id,
      'thumbnail',
      p_thumbnail_asset ->> 'bucket',
      p_thumbnail_asset ->> 'key',
      p_thumbnail_asset ->> 'url',
      p_thumbnail_asset ->> 'original_filename',
      p_thumbnail_asset ->> 'mime_type',
      v_thumbnail_size
    );
  END IF;

  INSERT INTO public.video_posts (
    user_id,
    channel_id,
    video_asset_id,
    thumbnail_asset_id,
    title,
    description,
    tags,
    category_id,
    target_privacy_status,
    made_for_kids,
    contains_synthetic_media,
    notify_subscribers,
    publish_at,
    schedule_timezone
  ) VALUES (
    v_user_id,
    p_channel_id,
    v_video_asset_id,
    v_thumbnail_asset_id,
    trim(p_title),
    trim(p_description),
    p_tags,
    '22',
    p_target_privacy_status,
    p_made_for_kids,
    p_contains_synthetic_media,
    p_notify_subscribers,
    p_publish_at,
    trim(p_schedule_timezone)
  )
  RETURNING * INTO v_post;

  RETURN v_post;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_video_draft(p_video_post_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_video_asset_id UUID;
  v_thumbnail_asset_id UUID;
  v_deleted_objects JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT post.video_asset_id, post.thumbnail_asset_id
    INTO v_video_asset_id, v_thumbnail_asset_id
  FROM public.video_posts AS post
  WHERE post.id = p_video_post_id
    AND post.user_id = v_user_id
    AND post.status = 'draft'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'owned draft not found';
  END IF;

  DELETE FROM public.video_posts
  WHERE id = p_video_post_id
    AND user_id = v_user_id
    AND status = 'draft';

  WITH deleted_assets AS (
    DELETE FROM public.media_assets AS asset
    WHERE asset.user_id = v_user_id
      AND asset.id IN (v_video_asset_id, v_thumbnail_asset_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.video_posts AS remaining_post
        WHERE remaining_post.video_asset_id = asset.id
          OR remaining_post.thumbnail_asset_id = asset.id
      )
    RETURNING asset.bucket, asset.key
  )
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('bucket', bucket, 'key', key)),
    '[]'::JSONB
  )
  INTO v_deleted_objects
  FROM deleted_assets;

  RETURN jsonb_build_object(
    'video_post_id', p_video_post_id,
    'objects', v_deleted_objects
  );
END;
$$;

REVOKE ALL ON FUNCTION public.youtube_tags_character_length(TEXT[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_video_draft(
  UUID, JSONB, JSONB, TEXT, TEXT, TEXT[], TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_video_draft(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_video_draft(
  UUID, JSONB, JSONB, TEXT, TEXT, TEXT[], TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_video_draft(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.youtube_tags_character_length(TEXT[]) TO authenticated;
