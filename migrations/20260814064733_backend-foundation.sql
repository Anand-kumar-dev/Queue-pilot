-- QueuePilot backend foundation.
-- User-facing records live in public tables with explicit RLS and grants.
-- OAuth credentials and worker internals are server-only: RLS is enabled with
-- no runtime policies or grants, while project-admin edge functions retain access.

CREATE TABLE public.profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 80),
  timezone TEXT NOT NULL DEFAULT 'UTC'
    CHECK (char_length(trim(timezone)) BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.youtube_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  youtube_channel_id TEXT NOT NULL UNIQUE
    CHECK (char_length(youtube_channel_id) BETWEEN 1 AND 100),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  handle TEXT,
  thumbnail_url TEXT,
  uploads_playlist_id TEXT,
  country TEXT CHECK (country IS NULL OR char_length(country) = 2),
  connection_status TEXT NOT NULL DEFAULT 'active'
    CHECK (connection_status IN ('active', 'refresh_required', 'revoked', 'disconnected')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, youtube_channel_id)
);

CREATE TABLE public.youtube_channel_credentials (
  channel_id UUID PRIMARY KEY REFERENCES public.youtube_channels(id) ON DELETE CASCADE,
  access_token_ciphertext TEXT NOT NULL CHECK (char_length(access_token_ciphertext) > 0),
  refresh_token_ciphertext TEXT,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  granted_scopes TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  token_type TEXT NOT NULL DEFAULT 'Bearer',
  encryption_key_version SMALLINT NOT NULL DEFAULT 1 CHECK (encryption_key_version > 0),
  last_refresh_at TIMESTAMPTZ,
  last_refresh_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.youtube_oauth_states (
  state_hash TEXT PRIMARY KEY CHECK (char_length(state_hash) = 64),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_verifier_ciphertext TEXT NOT NULL CHECK (char_length(code_verifier_ciphertext) > 0),
  redirect_uri TEXT NOT NULL CHECK (char_length(redirect_uri) BETWEEN 1 AND 2048),
  return_to TEXT NOT NULL DEFAULT '/',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE TABLE public.media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'thumbnail')),
  bucket TEXT NOT NULL,
  key TEXT NOT NULL CHECK (char_length(key) BETWEEN 1 AND 1024),
  url TEXT NOT NULL CHECK (char_length(url) BETWEEN 1 AND 4096),
  original_filename TEXT NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL CHECK (char_length(mime_type) BETWEEN 1 AND 255),
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 274877906944),
  duration_seconds NUMERIC(12, 3)
    CHECK (duration_seconds IS NULL OR (duration_seconds > 0 AND duration_seconds <= 43200)),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  checksum_sha256 TEXT CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'staged'
    CHECK (status IN ('staged', 'ready', 'failed', 'deleting', 'deleted')),
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bucket, key),
  CHECK (
    (kind = 'video' AND bucket = 'video-uploads')
    OR (kind = 'thumbnail' AND bucket = 'video-thumbnails')
  )
);

CREATE TABLE public.video_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES public.youtube_channels(id) ON DELETE RESTRICT,
  video_asset_id UUID REFERENCES public.media_assets(id) ON DELETE RESTRICT,
  thumbnail_asset_id UUID REFERENCES public.media_assets(id) ON DELETE RESTRICT,
  title TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 100),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
  tags TEXT[] NOT NULL DEFAULT '{}'::TEXT[] CHECK (cardinality(tags) <= 100),
  category_id TEXT NOT NULL DEFAULT '22' CHECK (category_id ~ '^[0-9]+$'),
  default_language TEXT,
  target_privacy_status TEXT NOT NULL DEFAULT 'public'
    CHECK (target_privacy_status IN ('private', 'unlisted', 'public')),
  made_for_kids BOOLEAN,
  contains_synthetic_media BOOLEAN NOT NULL DEFAULT false,
  notify_subscribers BOOLEAN NOT NULL DEFAULT true,
  license TEXT NOT NULL DEFAULT 'youtube' CHECK (license IN ('youtube', 'creativeCommon')),
  embeddable BOOLEAN NOT NULL DEFAULT true,
  public_stats_viewable BOOLEAN NOT NULL DEFAULT true,
  publish_at TIMESTAMPTZ,
  schedule_timezone TEXT NOT NULL DEFAULT 'UTC'
    CHECK (char_length(trim(schedule_timezone)) BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'queued', 'uploading', 'processing', 'scheduled', 'published', 'failed', 'cancelled')),
  youtube_video_id TEXT UNIQUE,
  youtube_upload_status TEXT
    CHECK (youtube_upload_status IS NULL OR youtube_upload_status IN ('uploaded', 'processed', 'failed', 'rejected', 'deleted')),
  progress_bytes BIGINT NOT NULL DEFAULT 0 CHECK (progress_bytes >= 0),
  queued_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  CHECK (publish_at IS NULL OR target_privacy_status = 'public')
);

CREATE TABLE public.youtube_upload_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_post_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'initializing', 'uploading', 'processing', 'retry_wait', 'succeeded', 'failed', 'cancelled')),
  resumable_session_ciphertext TEXT,
  resumable_session_expires_at TIMESTAMPTZ,
  offset_bytes BIGINT NOT NULL DEFAULT 0 CHECK (offset_bytes >= 0),
  total_bytes BIGINT NOT NULL CHECK (total_bytes > 0),
  chunk_size_bytes INTEGER NOT NULL DEFAULT 8388608
    CHECK (chunk_size_bytes > 0 AND mod(chunk_size_bytes, 262144) = 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  last_http_status INTEGER,
  last_error_code TEXT,
  last_error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (video_post_id, user_id)
    REFERENCES public.video_posts(id, user_id) ON DELETE CASCADE,
  CHECK (offset_bytes <= total_bytes),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);

CREATE TABLE public.video_post_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_post_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 80),
  detail JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(detail) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (video_post_id, user_id)
    REFERENCES public.video_posts(id, user_id) ON DELETE CASCADE
);

CREATE INDEX youtube_channels_user_id_idx ON public.youtube_channels (user_id);
CREATE INDEX youtube_oauth_states_user_expiry_idx ON public.youtube_oauth_states (user_id, expires_at);
CREATE INDEX media_assets_user_status_created_idx ON public.media_assets (user_id, status, created_at DESC);
CREATE INDEX video_posts_user_status_publish_idx ON public.video_posts (user_id, status, publish_at);
CREATE INDEX video_posts_channel_created_idx ON public.video_posts (channel_id, created_at DESC);
CREATE INDEX youtube_upload_jobs_ready_idx ON public.youtube_upload_jobs (state, next_attempt_at)
  WHERE state IN ('queued', 'retry_wait');
CREATE INDEX youtube_upload_jobs_lease_idx ON public.youtube_upload_jobs (lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;
CREATE INDEX video_post_events_post_created_idx ON public.video_post_events (video_post_id, created_at DESC);
CREATE INDEX video_post_events_user_created_idx ON public.video_post_events (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_video_post_references()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'video post owner cannot be changed';
  END IF;

  IF NEW.channel_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.youtube_channels c
    WHERE c.id = NEW.channel_id AND c.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'channel must belong to the video post owner';
  END IF;

  IF NEW.video_asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.media_assets a
    WHERE a.id = NEW.video_asset_id AND a.user_id = NEW.user_id AND a.kind = 'video'
  ) THEN
    RAISE EXCEPTION 'video asset must belong to the video post owner';
  END IF;

  IF NEW.thumbnail_asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.media_assets a
    WHERE a.id = NEW.thumbnail_asset_id AND a.user_id = NEW.user_id AND a.kind = 'thumbnail'
  ) THEN
    RAISE EXCEPTION 'thumbnail asset must belong to the video post owner';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_set_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER youtube_channels_set_updated_at
BEFORE UPDATE ON public.youtube_channels
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER youtube_channel_credentials_set_updated_at
BEFORE UPDATE ON public.youtube_channel_credentials
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER media_assets_set_updated_at
BEFORE UPDATE ON public.media_assets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER video_posts_validate_references
BEFORE INSERT OR UPDATE ON public.video_posts
FOR EACH ROW EXECUTE FUNCTION public.validate_video_post_references();

CREATE TRIGGER video_posts_set_updated_at
BEFORE UPDATE ON public.video_posts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER youtube_upload_jobs_set_updated_at
BEFORE UPDATE ON public.youtube_upload_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_channel_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_upload_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_post_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_owner_select ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY profiles_owner_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY profiles_owner_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY youtube_channels_owner_select ON public.youtube_channels
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY media_assets_owner_select ON public.media_assets
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY media_assets_owner_insert ON public.media_assets
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND status = 'staged');

CREATE POLICY video_posts_owner_select ON public.video_posts
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY video_posts_owner_insert ON public.video_posts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND status = 'draft');
CREATE POLICY video_posts_owner_update_draft ON public.video_posts
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND status = 'draft')
  WITH CHECK (user_id = (SELECT auth.uid()) AND status = 'draft');
CREATE POLICY video_posts_owner_delete_draft ON public.video_posts
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND status = 'draft');

CREATE POLICY video_post_events_owner_select ON public.video_post_events
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

GRANT USAGE ON SCHEMA public TO authenticated;

REVOKE ALL ON public.profiles FROM anon, authenticated;
REVOKE ALL ON public.youtube_channels FROM anon, authenticated;
REVOKE ALL ON public.youtube_channel_credentials FROM anon, authenticated;
REVOKE ALL ON public.youtube_oauth_states FROM anon, authenticated;
REVOKE ALL ON public.media_assets FROM anon, authenticated;
REVOKE ALL ON public.video_posts FROM anon, authenticated;
REVOKE ALL ON public.youtube_upload_jobs FROM anon, authenticated;
REVOKE ALL ON public.video_post_events FROM anon, authenticated;

GRANT SELECT, INSERT ON public.profiles TO authenticated;
GRANT UPDATE (display_name, timezone) ON public.profiles TO authenticated;
GRANT SELECT ON public.youtube_channels TO authenticated;
GRANT SELECT ON public.media_assets TO authenticated;
GRANT INSERT (
  id, user_id, kind, bucket, key, url, original_filename, mime_type,
  size_bytes, duration_seconds, width, height, checksum_sha256
) ON public.media_assets TO authenticated;
GRANT SELECT, DELETE ON public.video_posts TO authenticated;
GRANT INSERT (
  id, user_id, channel_id, video_asset_id, thumbnail_asset_id, title,
  description, tags, category_id, default_language, target_privacy_status,
  made_for_kids, contains_synthetic_media, notify_subscribers, license,
  embeddable, public_stats_viewable, publish_at, schedule_timezone
) ON public.video_posts TO authenticated;
GRANT UPDATE (
  channel_id, video_asset_id, thumbnail_asset_id, title, description, tags,
  category_id, default_language, target_privacy_status, made_for_kids,
  contains_synthetic_media, notify_subscribers, license, embeddable,
  public_stats_viewable, publish_at, schedule_timezone
) ON public.video_posts TO authenticated;
GRANT SELECT ON public.video_post_events TO authenticated;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_video_post_references() FROM PUBLIC, anon, authenticated;

-- Private, per-user storage. The first key segment must equal the caller's
-- JWT subject, e.g. <user-id>/<asset-id>/<safe-file-name>.
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS storage_objects_owner_select ON storage.objects;
DROP POLICY IF EXISTS storage_objects_owner_insert ON storage.objects;
DROP POLICY IF EXISTS storage_objects_owner_update ON storage.objects;
DROP POLICY IF EXISTS storage_objects_owner_delete ON storage.objects;

CREATE POLICY queuepilot_storage_owner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket IN ('video-uploads', 'video-thumbnails')
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
    AND (storage.foldername(key))[1] = (SELECT auth.jwt() ->> 'sub')
  );

CREATE POLICY queuepilot_storage_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket IN ('video-uploads', 'video-thumbnails')
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
    AND (storage.foldername(key))[1] = (SELECT auth.jwt() ->> 'sub')
  );

CREATE POLICY queuepilot_storage_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket IN ('video-uploads', 'video-thumbnails')
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
    AND (storage.foldername(key))[1] = (SELECT auth.jwt() ->> 'sub')
  )
  WITH CHECK (
    bucket IN ('video-uploads', 'video-thumbnails')
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
    AND (storage.foldername(key))[1] = (SELECT auth.jwt() ->> 'sub')
  );

CREATE POLICY queuepilot_storage_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket IN ('video-uploads', 'video-thumbnails')
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
    AND (storage.foldername(key))[1] = (SELECT auth.jwt() ->> 'sub')
  );

REVOKE ALL ON storage.objects FROM anon, authenticated;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
