# QueuePilot production deployment

**Live app:** https://pzmh35a7.insforge.site  
**Backend:** https://pzmh35a7.ap-southeast.insforge.app  
**Updated:** 2026-09-13

QueuePilot is deployed through InsForge hosting. InsForge uses Vercel as the
hosting provider internally, but frontend configuration, functions, schedules,
and data remain managed from this InsForge project.

## What is live

- Browser app with user-scoped authentication, private uploads, drafts, and a
  deliberate **Queue for YouTube** action.
- `youtube-oauth` for Google consent, PKCE, encrypted refresh-token storage,
  channel lookup, and disconnect.
- `youtube-publishing` for user-authorized queue, retry, and pre-transfer
  cancellation actions.
- `youtube-upload-pump` every five minutes. It transfers an explicitly queued
  video from private InsForge Storage to YouTube using an encrypted resumable
  session and 8 MiB chunks.
- `youtube-upload-status` every five minutes. It reconciles YouTube processing,
  future scheduled release, final public publication, and terminal errors.

The worker never calls a record `scheduled` merely because it has a requested
date. That state is set only after YouTube has returned a future `publishAt`.
Scheduled records continue to be checked after their target time until YouTube
reports the final public state.

## Credentials and configuration

### Browser deployment variables

These are saved in InsForge deployment environment configuration. They are
public browser values, not admin credentials:

- `VITE_INSFORGE_URL`
- `VITE_INSFORGE_ANON_KEY`
- `VITE_APP_NAME`

### Server-only InsForge secrets

These must remain only in InsForge Secrets and must never appear in a `VITE_`
variable, browser bundle, committed `.env` file, or support message:

- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REDIRECT_URI`
- `YOUTUBE_TOKEN_ENCRYPTION_KEY`
- `APP_URL`
- `APP_ALLOWED_ORIGINS`
- `API_KEY` / `INSFORGE_BASE_URL` (platform managed)

The production app origin is included in the InsForge authentication redirect
allowlist and in the OAuth function CORS allowlist. The Google Cloud web OAuth
client must retain this exact callback as its authorized redirect URI:

```text
https://pzmh35a7.function2.insforge.app/youtube-oauth
```

## Operator checklist before a real upload

1. In Google Cloud, confirm that the OAuth consent screen is **Production**,
   YouTube Data API v3 is enabled, and the callback above is on the same OAuth
   client whose ID/secret are saved in InsForge.
2. Sign into the live app and complete **Connect YouTube** once. This creates a
   fresh server-encrypted refresh token; do not import a local token file.
3. Create a disposable test draft with a short video, then explicitly choose
   **Queue for YouTube**.
4. Confirm the record moves through `queued` → `uploading` → `processing` and
   only then to `ready`, `scheduled`, or `published` based on a YouTube readback.
5. Check InsForge schedule logs and YouTube Studio. Delete the canary manually
   from Studio if it was only a test.

## Known limits

- The InsForge storage configuration intentionally caps a single source file at
  **200 MB**. The UI and database enforce the same limit. Do not advertise
  long-form multi-GB support until the backend is upgraded and a large-file
  canary has passed the storage-to-YouTube recovery path.
- This is a personal, single-operator tool. Email SMTP branding, a custom
  domain, monitoring/alerts, and managed backups are still recommended before
  handing it to other users.
- The worker relies on a valid YouTube refresh token and may require reconnect
  after Google revocation or scope changes.
