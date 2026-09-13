# QueuePilot app

QueuePilot is a personal YouTube publishing desk for preparing private media,
queuing uploads, and reconciling YouTube-confirmed schedule/publication state.

The app includes responsive application chrome, guarded routes, live InsForge
authentication, account creation and verification, password recovery, and a
server-side YouTube channel authorization boundary. The release desk reads only
real per-user records: users can upload private media, create and edit drafts,
queue a release for YouTube, filter the ledger, inspect a weekly calendar, and
delete drafts through a server-owned cleanup path. There is no fabricated
release data.

The server-owned YouTube transfer and status workers run on InsForge schedules.
A release is called scheduled only after YouTube confirms a future `publishAt`.

## Stack

- React 19, TypeScript, and Vite
- Tailwind CSS 3.4
- InsForge SDK for auth, database, storage, and edge functions
- TanStack Query for server state
- Vitest and Testing Library

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Add the public InsForge base URL and anonymous key. Never put an InsForge
   admin key in a `VITE_` variable.
4. Run `npm run dev`.

The database migrations include the atomic draft lifecycle and server-owned
YouTube queue lifecycle. Apply them only after a rollback/export path is
available:

```text
npx -y @insforge/cli db migrations up --all
```

The workspace is already linked to its InsForge project through ignored local
CLI configuration. See [DESIGN.md](./DESIGN.md) for the product UI rules and
[docs/production-deployment.md](./docs/production-deployment.md) for the live
deployment contract.

The connected InsForge 1.0 backend currently enforces a 200 MB upload ceiling.
The UI must communicate that limit until the backend storage path is upgraded
and a larger storage-to-YouTube recovery path is verified.

## Authentication and YouTube authorization

QueuePilot login and YouTube channel access are deliberately separate grants:

- InsForge owns the app session, email verification, password reset, and
  optional Google/GitHub app login.
- The `youtube-oauth` edge function owns YouTube consent, PKCE state, token
  exchange, encrypted refresh-token storage, channel lookup, and revocation.
- `youtube-publishing`, `youtube-upload-pump`, and `youtube-upload-status`
  own queue actions, private transfer, and YouTube status reconciliation.
- No Google OAuth client secret or YouTube refresh token is exposed to React or
  stored in this repository.

The live app runs at `https://pzmh35a7.insforge.site`. The Google Cloud web
OAuth client must retain this exact authorized redirect URI:

```text
https://pzmh35a7.function2.insforge.app/youtube-oauth
```

See [docs/production-deployment.md](./docs/production-deployment.md) before
changing the production domain, OAuth callback, or server secrets.

## Quality checks

Run `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`
before handing off a milestone.
