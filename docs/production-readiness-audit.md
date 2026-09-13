# QueuePilot production-readiness audit

> **Superseded implementation snapshot:** This is the pre-pipeline audit from August 2026. For the live state as of 2026-09-13, including deployed workers, schedules, production redirects, required credentials, and remaining launch gates, use [production-deployment.md](production-deployment.md). The historical findings remain useful context but must not be read as current system status.

Audit date: 2026-08-16  
Backend: `https://pzmh35a7.ap-southeast.insforge.app`  
Audit mode: read-only, using the linked InsForge OSS project

## Implementation update — 2026-08-24

- The release desk now uses real, user-scoped query keys and exact backend counts, supports accessible stage-key navigation, weekly calendar movement, metadata byte/character validation, multi-channel draft selection, stored-draft editing, real asset previews, and an accessible draft deletion confirmation.
- Draft creation and deletion RPCs are prepared in the additive `20260824151319_add-draft-lifecycle-rpcs.sql` migration. The migration has not been applied.
- The linked OSS backend currently returns HTTP 503 (`No backend services available for app`) to project API and migration requests. InsForge feedback `184da7c2-b644-4da2-8c5d-0dfe3b6edf18` records the platform blocker.
- The healthy-control observations below are the 2026-08-16 snapshot. They could not be revalidated while the backend was unavailable.

## Executive result

The current backend is a sound foundation for authenticated drafts and YouTube
channel authorization, but it is not yet a working YouTube publishing service.
The production database truth is:

- one active YouTube channel with one encrypted credential row and a refresh token;
- one staged video asset and one draft video post;
- zero upload jobs;
- zero backend schedules;
- no YouTube upload, processing, reconciliation, retry, or cancellation functions.

Therefore the app must present the existing record as a draft. It must not call
it scheduled until YouTube has created a video and confirmed `status.publishAt`.

## Verified healthy controls

- The `video-uploads` and `video-thumbnails` buckets are private.
- Storage RLS restricts select, insert, update, and delete operations to the
  authenticated owner and requires the first object-key segment to match that
  owner. The live object audit found zero path/owner mismatches.
- RLS is enabled on all eight QueuePilot public tables and on `storage.objects`.
- Browser roles cannot read OAuth credentials, OAuth state, upload jobs, or
  write video event history. Those server-owned tables have no browser grants.
- Owner policies use `(SELECT auth.uid())` and include `WITH CHECK` on client
  inserts and updates.
- Draft-edit privileges are column-scoped; browser users cannot set lifecycle,
  progress, YouTube ID, or server error fields.
- The deployed `youtube-oauth` function is active and its runtime is running.
- All required OAuth app secrets are active: client ID, client secret, redirect
  URI, app URL, allowed origins, and the token-encryption key. Secret values
  were not read during this audit.
- The stored channel credential includes a refresh token. There are no expired,
  unconsumed OAuth-state rows.
- Database health showed no slow queries and no locks. The database is small
  (approximately 0.012 GB) and the storage footprint is approximately 0.011 GB.

## Production blockers

### P0: publishing pipeline does not exist

Only `youtube-oauth` is deployed. The required enqueue, resumable transfer,
processing reconciliation, retry, cancellation, and status functions do not
exist, and there are no schedules to run them.

### P0: production authentication redirects are absent

InsForge Auth currently allows only localhost and `127.0.0.1` callback,
sign-in, and reset-password URLs. The final deployed app origin must be added
before production authentication can be considered complete. The InsForge
deployment registry is empty; a deployment performed directly through Vercel
or another provider will not appear there, but its URLs still need to be in
the auth allowlist.

### P0: long-form storage is capped at 200 MB

The live configuration matches `insforge.toml` and limits each stored file to
200 MB. The backend reports version `1.0.0`; the InsForge S3 multipart gateway
requires a newer backend. Long-form support cannot be claimed until a large
file can be uploaded, range-read by the worker, transferred to YouTube, retried,
and cleaned up successfully on this deployment.

### P0: no managed backup or isolated backend branch

The backend reports that managed database backups are unavailable. Cloud branch
commands require platform authentication and this API-key-linked OSS backend is
also below the branch-capable 2.x generation. Before any production migration,
we need a protected manual export and a reviewed additive migration with a
separate rollback procedure. We must not claim that a backend branch exists.

### P1: production status reconciliation is absent

There is no worker that compares QueuePilot state with YouTube's video resource.
The UI must keep `draft`, `queued`, `uploading`, `processing`, `scheduled`, and
`published` distinct. A requested `publish_at` value alone is not proof of a
YouTube schedule.

### P1: production operations are incomplete

- Realtime is not configured, so progress currently requires bounded polling.
- There is no upload lease runner, retry cadence, quota guard, or orphan cleanup.
- There is no function/schedule execution history because those services do not
  exist yet.
- Advisor, cloud metrics, built-in backups, and agent memory are unavailable in
  the current API-key-linked OSS mode. Security review must continue through
  live catalog queries, policies, database health, and logs.

## Non-blocking observations

- The health snapshot reported 15 active database connections out of 30. There
  were no slow queries or locks, but connection usage should be measured again
  during upload-worker load testing.
- Cache hit was 98.7%. With the current tiny dataset this is not an incident; it
  becomes meaningful only alongside sustained latency or resource pressure.
- Email verification is enabled. Password policy currently requires eight
  characters but does not require character classes.
- Google and GitHub sign-in providers are configured; their production callback
  URLs must be validated before their buttons remain visible in the release UI.

## Safe implementation order

1. Keep all current records truthful and remove remaining hard-coded navigation
   counts or actions.
2. Build the Buffer-inspired application shell and publishing views locally,
   against the existing read-only data surface.
3. Implement and unit-test enqueue and worker functions without deploying them.
4. Establish the manual export/rollback path before any production schema change.
5. Deploy server functions individually, verify logs, then create schedules.
6. Run a private canary upload, processing check, and scheduled release on the
   connected channel before enabling publishing actions for general users.
7. Enable long-form claims only after a file larger than 200 MB passes the full
   storage-to-YouTube recovery test.

## Release invariants

- No demo business data or synthetic counts in authenticated product screens.
- No `scheduled` label before YouTube confirms the schedule.
- No browser access to OAuth credentials or upload-job mutation.
- Every storage row preserves both object URL and key.
- Every retry is idempotent and resumes from YouTube's acknowledged byte offset.
- Every terminal failure identifies the failing subsystem and keeps a safe retry
  or cleanup path.
