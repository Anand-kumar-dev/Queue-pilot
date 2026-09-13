# Backend architecture

This milestone establishes the storage, authorization, and draft-lifecycle contract for QueuePilot. The YouTube OAuth function has a local-development routing and encryption contract. Upload workers intentionally remain undeployed until their compatibility spike succeeds; the product does not expose a publish action while that server capability is absent.

## Ownership model

The MVP is user-owned. Every public record that can grow carries `user_id` directly so RLS does not need cross-table joins. Teams and billing are a later migration.

| Surface | Browser access | Server-only responsibility |
| --- | --- | --- |
| `profiles` | Read, create, update own display name and time zone | None |
| `youtube_channels` | Read own safe channel metadata | Connect, refresh, revoke and disconnect |
| `youtube_channel_credentials` | None | Encrypted access and refresh tokens |
| `youtube_oauth_states` | None | One-time state and PKCE verifier lifecycle |
| `media_assets` | Read and register own staged asset | Verify bytes/MIME, advance status and remove orphans |
| `video_posts` | Read own; create/edit/delete only drafts | Queue and all subsequent state transitions |
| `youtube_upload_jobs` | None | Resumable session, offset, retry and lease state |
| `video_post_events` | Read own timeline | Append sanitized lifecycle events |

Both storage buckets are private. Object keys have the form `<user-id>/<asset-id>/<safe-file-name>`, and storage RLS verifies both the uploader and the first path segment.

## Draft lifecycle

The browser uploads video and optional thumbnail bytes to private storage first, then calls `create_video_draft`. That database function derives ownership from `auth.uid()` and registers both media rows plus the draft in one transaction. If the transaction fails, the browser removes the newly uploaded objects; it never leaves a partially created set of database rows.

`delete_video_draft` is a narrowly granted `SECURITY DEFINER` operation. It locks and deletes only an authenticated user's draft, removes media rows only when no other post references them, and returns the exact private object keys eligible for storage cleanup. The browser validates those returned bucket/key scopes before removal. If object cleanup fails after the database commit, the UI reports cleanup as pending instead of claiming full success.

## Edge-function boundaries

1. The deployed `youtube-oauth` function authenticates app users for its `start` and `disconnect` actions. Start creates a short-lived state plus PKCE verifier, stores only their hash/encrypted form, and returns the Google authorization URL.
2. The same function's public callback consumes state exactly once, exchanges the code, verifies the exact granted scopes, fetches the authorized channel, encrypts tokens with AES-GCM, and upserts the safe channel row plus server-only credentials.
3. Disconnect rechecks ownership, revokes the Google grant when possible, removes credential material, and marks the channel disconnected without deleting publication history.
4. A future `youtube-upload-enqueue` function validates draft ownership, channel state, ready media, audience selection, metadata limits and a future UTC schedule before atomically creating the job.
5. A future `youtube-upload-pump` function is internal-only. It claims a short lease, refreshes OAuth if necessary, initiates or resumes the YouTube session, advances acknowledged bytes and mirrors only safe progress to `video_posts`.
6. A future `youtube-upload-status` function polls YouTube processing after byte transfer and moves the post to `scheduled`, `published`, or a terminal failure state.
7. Future retry and cancel actions authenticate ownership but let server code decide whether a transition is still safe.

Google tokens and resumable-session URLs are never returned to the browser. Ciphertext uses a versioned AES-GCM envelope and a server-only encryption key so keys can be rotated later.

## Scheduling contract

`publish_at` is stored as UTC together with the IANA time zone used for display. A scheduled public release is sent to YouTube with `privacyStatus: private` and the future `status.publishAt` value; YouTube performs the release, so QueuePilot does not run a publish-at-time cron job. QueuePilot schedules only uploads, retries, and processing checks.

The application model records YouTube's documented ceiling of 256 GB or 12 hours, but this InsForge deployment currently accepts at most 200 MB. `config plan` rejects larger values, and this backend version also stores object size in a signed 32-bit integer. The product must show the 200 MB active cap before transfer. This is enough only for some compressed long-form files; general multi-GB long-form support is gated on an InsForge upgrade or expanded storage capability. Videos longer than 15 minutes also depend on the connected channel's YouTube verification state.

## Upload reliability

YouTube resumable uploads acknowledge an exact byte range. Jobs persist the last acknowledged offset and use 8 MiB chunks (a multiple of the required 256 KiB). Retriable `500`, `502`, `503`, and `504` responses use exponential backoff and respect `Retry-After`; other failures require explicit classification before retry.

Before implementing the pump, run a compatibility spike against this InsForge 1.0 backend to prove efficient ranged reads from private storage. If ranged reads are unavailable, upgrading InsForge is the correct next decision; credentials must not be moved into the browser or into an unrelated storage provider as a shortcut.

## Source references

- [YouTube video resource and scheduling rules](https://developers.google.com/youtube/v3/docs/videos)
- [YouTube resumable upload protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)
- [YouTube long-video and file-size limits](https://support.google.com/youtube/answer/71673)
- [InsForge storage S3-compatible gateway](https://docs.insforge.dev/core-concepts/storage/s3-compatibility)
