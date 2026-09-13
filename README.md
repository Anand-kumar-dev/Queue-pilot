# QueuePilot app

QueuePilot is the working name for a Buffer-style YouTube scheduling SaaS. This repository contains the authenticated React application; the SEO-focused Astro marketing site will be built separately later.

The app foundation includes responsive application chrome, guarded routes, live InsForge authentication, account creation and verification, password recovery, and a server-side YouTube channel authorization boundary. The release desk reads only real per-user records: users can upload private media, create and edit drafts, filter the ledger, inspect a weekly calendar, and delete drafts through a server-owned cleanup path. There is no fabricated release data.

The YouTube transfer worker is not deployed yet, so the UI deliberately does not offer a fake “publish” action. A record is called scheduled only after a future worker receives confirmation from YouTube.

## Stack

- React 19, TypeScript, and Vite
- Tailwind CSS 3.4
- InsForge SDK for auth, database, storage, and edge functions
- TanStack Query for server state
- Vitest and Testing Library

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Add the public InsForge base URL and anonymous key. Never put an InsForge admin key in a `VITE_` variable.
4. Run `npm run dev`.

The additive draft-lifecycle migration is [migrations/20260824151319_add-draft-lifecycle-rpcs.sql](./migrations/20260824151319_add-draft-lifecycle-rpcs.sql). It atomically registers uploaded media and its draft, and it provides the ownership-checked draft deletion operation used by the UI. Apply it only after the linked backend is healthy and a rollback/export path is available:

```text
npx -y @insforge/cli db migrations up 20260824151319_add-draft-lifecycle-rpcs.sql
```

The workspace is already linked to its InsForge project through ignored local CLI configuration. See [DESIGN.md](./DESIGN.md) for the product UI rules and `design-sources/` for the source references.

The provisioned backend contract, RLS model, OAuth boundaries, and upload constraints are documented in [docs/backend-architecture.md](./docs/backend-architecture.md). The connected InsForge 1.0 backend currently enforces a 200 MB upload ceiling; the UI must communicate that limit until the backend storage path is upgraded for general multi-GB long-form video.

## Authentication and YouTube authorization

QueuePilot login and YouTube channel access are deliberately separate grants:

- InsForge owns the app session, email verification, password reset, and optional Google/GitHub app login.
- The `youtube-oauth` edge function owns YouTube consent, PKCE state, token exchange, encrypted refresh-token storage, channel lookup, and revocation.
- No Google OAuth client secret or YouTube refresh token is exposed to React or stored in this repository.

The latest verified deployment placed the edge function at `https://pzmh35a7.function2.insforge.app/youtube-oauth`. Before the Connect YouTube button can complete in a new environment, configure a Google Cloud web OAuth client:

1. Enable YouTube Data API v3 and configure the OAuth consent screen.
2. Add the exact authorized redirect URI `https://pzmh35a7.function2.insforge.app/youtube-oauth`.
3. Add the two server secrets with `npx -y @insforge/cli secrets add YOUTUBE_CLIENT_ID "<client-id>"` and `npx -y @insforge/cli secrets add YOUTUBE_CLIENT_SECRET "<client-secret>"`.
4. Keep the requested `youtube.upload` and `youtube.readonly` scopes in the consent configuration. The upload scope is needed to create uploads; the read-only scope identifies the channel that granted access.

The current edge-function app URL and CORS allowlist target local Vite development. Once the production domain is selected, update `APP_URL`, `APP_ALLOWED_ORIGINS`, `YOUTUBE_REDIRECT_URI` if the function host changes, and the allowed redirects in `insforge.toml` before applying the config.

## Quality checks

Run `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build` before handing off a milestone.
