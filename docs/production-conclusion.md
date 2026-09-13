# QueuePilot production conclusion

> **Current operational status (2026-09-13):** The historical assessment below is retained for its design and launch rationale, but its implementation snapshot is superseded by [production-deployment.md](production-deployment.md). The live InsForge project now has the draft-lifecycle and publishing-pipeline migrations applied, the authenticated publishing gateway plus upload and status workers deployed, and two five-minute worker schedules active. Production auth redirects include `https://pzmh35a7.insforge.site`. A real connected-channel canary is still required before claiming end-to-end publishing validation; the 200 MB storage ceiling remains in effect.

Research date: 2026-09-12
Sources: Buffer / TubeBuddy / Hootsuite / PostEverywhere product pages, YouTube Data API v3 resumable-upload + upload guides, YouTube quota/429 incident reports (May 2026), SaaSUI 2026 dashboard patterns (Linear / Vercel / Stripe / Attio), plus local audit in `docs/production-readiness-audit.md` and `docs/backend-architecture.md`.

## 1. What "production level" means for a YouTube scheduler

A production scheduler is not a nicer upload form. It is five promises:

1. **Truthful state.** `draft` / `queued` / `uploading` / `processing` / `scheduled` / `published` / `failed` must each mean what YouTube confirmed — never what the user intended. Native Studio gets this free; third-party tools earn trust by never calling a target time "scheduled".
2. **Resumable, idempotent transfer.** YouTube's resumable protocol: `POST` session → `Location` URI → `PUT` bytes with `Content-Length` / `Content-Type` / `Content-Range`. Chunks must be multiples of 256 KiB (8 MiB in our contract). `308 Resume Incomplete` + `Range` header tells you where to resume. Retry only `500/502/503/504` with exponential backoff and honor `Retry-After`. Sessions expire (~1 week). Every retry resumes from YouTube's acknowledged offset, never from zero.
3. **Quota-aware.** `videos.insert` costs ~1600 units against a 10k/day default (≈6 uploads/day before extension). Unauthorized/lightweight calls still burn quota — validate auth with cheap `list` calls first. Since May 2026 there is a separately-enforced hidden `Video Uploads per day` 429 (~7/day) that does not show in Cloud Console quota graphs. Production needs: per-channel quota guard, daily budget display, graceful 429 messaging, and a quota-extension request before launch.
4. **OAuth done right.** OAuth2 web flow with PKCE + `offline` + `consent`, `youtube.upload` + `youtube.readonly` scopes verified post-exchange, encrypted refresh-token storage (AES-GCM, versioned envelope, server-only), channel-ownership check (one channel → one workspace), revocation on disconnect. Service keys do not work. Tokens never reach the browser.
5. **Scheduling contract.** `publishAt` is sent as `status.publishAt` with `privacyStatus: private`; YouTube performs the release. No publish-at-time cron. Display timezone stored alongside UTC. Videos >15 min require channel verification. Scheduled releases targeting public privacy only.

Competitor pattern summary:
- **Buffer:** queue + calendar views, preset/custom times, bulk scheduling (2025), cross-posting, unified inbox. Lesson: calendar + list are both mandatory; bulk is expected.
- **TubeBuddy:** best-time suggestions from audience habits, bulk metadata/thumbnail updates, scheduled unpublish/unlist, A/B testing, competitor scorecards. Lesson: value is in timing intelligence + bulk edits, not just upload.
- **Hootsuite / PostEverywhere:** team approval flows, mobile scheduling, batch 5–10 uploads, AI metadata (titles/descriptions/tags). Lesson: batch + mobile + AI-assist are table stakes for creators; AI must feel like autocomplete, not a chatbot badge.
- **Native Studio:** free, desktop-only, one-at-a-time, no bulk, no unified scheduled-vs-published dashboard. Lesson: our wedge is batch + truthful ledger + timezone-correct calendar.

## 2. Professional UI conclusion (anti-slop rules)

2026 pro-dashboard consensus (Linear / Vercel / Stripe):

- **Calm by default.** Only the current workflow is visible. Progressive disclosure for power features. Whitespace is functional. Typography carries hierarchy — not competing icons.
- **Color = meaning.** Monochrome system + one product accent (our coral `signal`) + semantic colors only with explicit status text. No gradients, glass, glow, pastel KPI tiles, decorative charts, or fake metrics.
- **Tables are the interface.** Find row → decide → act without leaving. Sort/filter/persist last view. Our warm-paper ledger with rule-separated rows (not cards) already follows this; keep it.
- **Empty states onboard.** Explain what will appear, why it matters, one clear action. Our lane copy already does this; keep it factual.
- **Command palette when >10 features.** Future work (`Cmd+K`: new upload, go to lane, search, reconnect). Not built in this pass — noted, not faked.
- **AI as infrastructure.** No "Powered by AI" badges. If we add title/description assist later, it appears inline in the composer, not as a marketing strip.

QueuePilot's existing system (black frame + paper ledger, Instrument Sans + IBM Plex Mono, coral once per viewport) is already anti-generic. This pass **doubles down on it** instead of replacing it: fix contrast/labels, tighten type scale to DESIGN.md tokens, add error boundaries/offline/404/headers, sanitize errors. No sidebar rail, no green CTA, no KPI cards, no illustrations.

## 3. Where QueuePilot stands (truth)

Already production-grade:
- InsForge auth (email verify, recovery, Google/GitHub login), guarded routes, RLS owner policies with `WITH CHECK`, private buckets with path-scoped keys, atomic `create_video_draft` + ownership-checked `delete_video_draft`, YouTube OAuth boundary (PKCE state, scope verification, AES-GCM tokens, revoke on disconnect), YouTube-limit validation (100-char title, 5000-byte description, 500-char/100-count tags, 200 MB active cap messaging, 5-min future schedule rule).

Deliberately absent (do not fake):
- `youtube-upload-enqueue` / `pump` / `status` / `retry` / `cancel` functions, schedules/leases, realtime progress (bounded polling only), quota guard, orphan cleanup, managed backups/branches, production auth redirect allowlist, >200 MB ranged-read spike. The UI offers no Publish action until the worker confirms with YouTube.

## 4. Safe build order (unchanged)

1. Frontend truth + polish (this pass).
2. Enqueue + worker functions implemented + unit-tested locally, undeployed.
3. Manual export/rollback path before any prod migration.
4. Deploy functions one by one, verify logs, then create schedules.
5. Private canary upload → processing check → scheduled release on connected channel.
6. Enable long-form claims only after a >200 MB file passes storage→YouTube→cleanup recovery.

## 5. What this pass changed

- `docs/production-conclusion.md` (this file): the researched scope.
- `src/lib/errors.ts`: user-safe error mapping (network / auth / RLS / quota / validation) — no raw backend leakage.
- `src/components/ErrorBoundary.tsx` + wiring in `main.tsx`: crash fallback in-system, one-retry, report-nothing-external.
- `src/App.tsx`: skip link, `NotFound` route (no dead ends), YouTube OAuth notice preserved.
- `index.html`: correct `theme-color` (`#0a0a09`), OG/meta truthful copy, no fake claims.
- `vercel.json`: SPA rewrite + security headers (`nosniff`, `DENY` framing, strict referrer) + immutable asset caching.
- `AuthLayout`: brand mark unified with app runway mark, "Working title" → "Release operations", contrast fix (`brand-ink` on coral), artifact stays labeled Example.
- `PublishingWorkspace`: ledger title scale to 40px token, filter label truth ("All connected channels"), touch/keyboard preserved, coral-once discipline kept.
- `QueryClient` defaults: `gcTime`, `refetchOnReconnect`, single retry — calm data behavior.
