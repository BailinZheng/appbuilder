# Architecture

This document explains how AppBuilder is put together. For setup instructions see the [README](../README.md).

- [Multi-tenancy and routing](#multi-tenancy-and-routing)
- [Site model: blocks instead of code](#site-model-blocks-instead-of-code)
- [Billing core: credits and hosting](#billing-core-credits-and-hosting)
- [AI layer](#ai-layer)
- [Image uploads](#image-uploads)
- [Internationalisation](#internationalisation)
- [Accounts, e-mail and the daily job](#accounts-e-mail-and-the-daily-job)
- [Developer tools](#developer-tools)
- [Testing](#testing)
- [Production readiness checklist](#production-readiness-checklist)

## Multi-tenancy and routing

One Next.js application serves both the platform and every customer site.

- `src/proxy.ts` rewrites `<slug>.ROOT_DOMAIN` (e.g. `baeckerei.localhost:3000`) to `/s/<slug>/…` and marks the
  request so that links inside the site are relative to the subdomain. `/_next`, `/api`, `/media` and `/sw.js`
  are left untouched so they work on every host.
- `src/app/s/[slug]/` contains the public site: page, Impressum, privacy policy, a per-site web manifest
  and a generated app icon. `public/sw.js` is one shared service worker (network-first with offline fallback).
- Tenant isolation: every dashboard query and server action re-checks the session and filters by `owner_id`.
  PostgreSQL row-level security is planned as a second layer.

## Site model: blocks instead of code

A customer site is a JSON document (`AppDefinition`) of typed blocks – header, text, image, button, opening hours,
contact form – validated with Zod (`src/lib/app-definition.ts`) and rendered by `src/components/AppRenderer.tsx`
for both the public site and the editor preview. Links are restricted to `http(s)`, `mailto:`, `tel:` and relative
URLs, which rules out `javascript:` XSS.

**Adding a block type**

1. Add it to `blockSchema`, `BLOCK_TYPES`, `STARTER` and `newBlock()` in `src/lib/app-definition.ts`
2. Add its name to `editor.blocks` (and field labels to `editor.fields`) in **both** languages in `src/i18n/dictionaries.ts`
3. Render it in `BlockView` (`src/components/AppRenderer.tsx`)
4. Add its inputs in `BlockFields` (`src/app/dashboard/apps/[id]/editor.tsx`)

## Billing core: credits and hosting

Pay-as-you-go credits pay for AI actions; one-time hosting passes keep a site online. No subscription is required.

```
src/lib/billing/
  catalog.ts          prices, credit packs, hosting passes – the only place prices live (PRICE_LIST_VERSION)
  ledger.ts           credit lots, reserve → capture | release, expiry, history, invariant check
  billed-action.ts    runBilledAction(): reserve → compute (AI) → charge + save result in ONE transaction
  purchases.ts        createPurchase / fulfillPurchase – idempotent, shared by the Stripe webhook and dev checkout
  payment-provider.ts PaymentProvider interface ("dev" = simulated checkout, "stripe" = Stripe Checkout)
  stripe.ts           Checkout Sessions, webhook event handling, session ↔ purchase verification
  free-preview.ts     runFreePreview(): quota check → compute (AI) → save result, for a user's free first site
  hosting.ts          hosting status: active → 14-day grace → lapsed (offline, never deleted)
```

- **Credit lots.** Each purchase or grant is a lot with its own source and expiry; spending draws from the
  soonest-expiring lot first.
- **Reserve → capture/release.** Reserving locks the user's lots (`SELECT … FOR UPDATE`), so parallel requests
  cannot double-spend; CHECK constraints make negative balances impossible at the database level.
- **Atomic charging.** `runBilledAction` captures the final price and commits the action's result in the same
  transaction. If the AI call fails, produces nothing useful, or saving fails, the reservation is released.
- **Append-only history.** `credit_transactions` is never updated or deleted. The invariant
  `SUM(credit_transactions.delta) = SUM(credit_lots.remaining) + SUM(active holds)` is verified by the tests
  and shown on `/dev`.
- **Metered actions.** Free-form AI instructions are billed by measured token cost × markup, clamped to an
  advertised range; the maximum is reserved up front.
- **Free undo.** Every AI change snapshots the previous version in `app_versions`.

### Stripe Checkout

`PAYMENT_PROVIDER=stripe` with `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.

- **Checkout.** Buying creates a pending purchase, then a Checkout Session priced from that purchase row
  (`price_data`, so no products have to be set up in Stripe), with the purchase id as `client_reference_id`, the
  session id stored as `provider_ref`, an idempotency key per purchase, and a 1-hour expiry. Payment methods come
  from the Stripe dashboard (cards, SEPA direct debit, PayPal …).
- **Webhook** `POST /api/stripe/webhook` – subscribe to `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and
  `checkout.session.expired`. The raw body is verified against the `Stripe-Signature` header. A session is only
  fulfilled when it is paid **and** matches its purchase (id, session id, amount, currency); delayed methods wait for
  `async_payment_succeeded`; failed or expired sessions cancel the purchase. Only errors a retry can fix return 500.
- **Return page.** `/dashboard/billing?checkout=success&session_id=…` retrieves the session and fulfils it at once
  (for the buyer only), so credits appear without waiting for the webhook. Webhook and return page can both run –
  `fulfillPurchase` grants exactly once.
- Not handled automatically yet: refunds and disputes (credits are not taken back), invoices and Stripe Tax.

### Free AI preview

A user's first "Create with AI" is free. `runFreePreview` mirrors `runBilledAction` without credits: it claims a slot,
runs the AI, then records the AI usage (`credits_charged = 0`) and saves the site in one transaction.

- **Limits** (`freePreviewLimits()` in `catalog.ts`): 1 per user, 3 per network per 24 h, 200 per 24 h overall and a
  daily AI cost budget of 25 USD (running previews count with an estimate). The global values can be lowered with
  `FREE_PREVIEW_DAILY_LIMIT` / `FREE_PREVIEW_DAILY_BUDGET_USD`; `0` switches free previews off.
- **Atomic.** Limits are checked and the attempt recorded under a PostgreSQL advisory lock, so parallel requests cannot
  slip past them. A failed AI call does not use up the user's preview but still counts towards the network and global
  limits, so failures cannot be used to hammer the AI.
- **Abuse protection.** Accounts need a confirmed e-mail address before they can sign in, so the per-user limit is
  tied to a real mailbox; the per-network and global limits cap the cost of throwaway addresses. The client IP is the entry the reverse proxy appended to `X-Forwarded-For` (`TRUST_PROXY_HOPS`);
  IPv6 addresses count per /64. A honeypot form field turns simple bots away; Better Auth rate-limits sign-ups.
- **Privacy.** Only an HMAC of the network (keyed with `BETTER_AUTH_SECRET`) is stored, and it is deleted after two
  days. Without a known client IP, the per-network limit does not apply – the global limits still do.

## AI layer

```
src/lib/ai/
  types.ts           AiProvider interface, site brief, edit requests, token usage
  patches.ts         patch operations returned by the AI + applyPatches() (validated, id/type immutable)
  pricing.ts         model token prices → cost; metered credits
  provider.ts        getAiProvider(): "mock" (default) or "anthropic"
  anthropic-provider.ts  Claude: structured output, strict patch tools, web fetch, prompt caching, usage
  anthropic-prompts.ts   frozen system prompts (cacheable) and per-request user messages
  json-schema.ts     Zod → JSON schema in the subset Claude enforces (closed objects, const/enum kept)
  mock-provider.ts   deterministic demo AI (German/English industry templates, simulated token usage)
  reference-url.ts   normalisation and validation of reference URLs
```

- **Site generation** returns a complete `AppDefinition`; **edits** return a list of patch operations, which keeps
  the expensive output tokens small and every change reviewable.
- **Reference URLs.** The brief may contain the customer's existing website (a source of facts such as services and
  contact details) and a design-inspiration website (a source of style only – colours, layout, tone; never texts,
  images or logos). Both are normalised (`firma.de` → `https://firma.de/`), limited to public http(s) hosts so they
  can never point at internal infrastructure, and stored in `apps.ai_brief`. The Claude provider reads them with
  Anthropic's server-side web fetch tool, so the platform itself never fetches arbitrary URLs.

### Claude provider

`AI_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` (model: `ANTHROPIC_MODEL`, default `claude-opus-5-5`).

- **Generate = structured output.** `output_config.format` constrains the answer to the site schema (blocks without
  ids – ids are always assigned by us). The answer is parsed with the same Zod schema and validated like any other
  site before anyone is charged.
- **Edit = strict patch tools.** One tool per patch operation with `strict: true`, so every call matches its schema.
  Each call is applied to a working copy immediately; errors (unknown block, a field the block type does not have,
  an unsafe link) go back to Claude as `is_error` tool results so it can correct itself, for up to 5 round trips.
  The provider returns the successful operations, which the action re-applies to the stored site. Forced
  `tool_choice` is not used – Claude Opus 5.5 rejects it – so “no change” is a valid answer and costs nothing.
- **Reference sites = web fetch.** The `web_fetch` server tool is only added when the brief has reference URLs, and
  `allowed_domains` limits it to those hosts (max. 4 fetches, 15k tokens each). The prompt treats the existing site
  as a source of facts and the inspiration site as a source of style only, and all fetched content as untrusted data.
  Paused server-tool turns (`pause_turn`) are resumed.
- **Prompt caching.** The system prompts are frozen strings with a cache breakpoint; everything that varies (brief,
  site, language, request) comes after it. Automatic caching also covers the growing conversation in the edit loop.
- **Billing stays exact.** Usage of every request (input, output incl. thinking, cache reads and writes) is summed
  and recorded. Refusals and truncated answers throw, so the credit reservation is released. Server-side refusal
  fallbacks (`fallbacks: "default"`) are enabled; if a fallback model answers, the whole action is billed at that
  model's price (`MODEL_PRICES`).
- **Effort.** Generation runs at `medium`, edits at `low`, which keeps a free-form instruction well inside its
  credit range. Each API attempt times out after 3 minutes (2 retries), below the 15-minute credit hold.

## Image uploads

```
POST /api/media        session + app ownership required; multipart `file` + `appId`
GET  /media/<id>.webp  public, cached as immutable (IDs are unguessable); served on every host
src/lib/media/
  limits.ts     5 MB per file, 2000 px longest side, 100 images per app, accepted types
  images.ts     type detection from file bytes (JPEG/PNG/WebP/GIF, never SVG); sharp pipeline
  storage.ts    MediaStorage interface (put/get/delete/list); local disk in MEDIA_DIR (default ./data/uploads,
                git-ignored) or S3
  s3.ts         S3-compatible client: PUT/GET/DELETE/ListObjectsV2 with AWS Signature V4, no SDK
  uploads.ts    saveImageUpload(): validation → processing → storage → database row
  cleanup.ts    cleanupMedia(): unused uploads and orphaned files (daily job)
```

Every upload is auto-rotated, scaled down to at most 2000 px and re-encoded as WebP. Re-encoding removes all
metadata, including GPS coordinates that phone photos often contain. The editor's `ImageDropzone` supports
drag & drop, click, keyboard and paste, with progress, preview and localised errors.

### Object storage (`MEDIA_STORAGE=s3`)

Works with any S3-compatible service – for GDPR, preferably one in the EU such as Hetzner Object Storage
(`S3_ENDPOINT=https://fsn1.your-objectstorage.com`, `S3_REGION=fsn1`). Settings: `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, optionally `S3_PREFIX` (e.g. `media/`) and `S3_FORCE_PATH_STYLE=true` (MinIO).

- **Private bucket.** Images are still delivered through `/media/<id>.<ext>`, which checks the database row and
  sets the security headers. The bucket needs no public access and no CORS rules.
- **No SDK.** Four request types do not justify a large dependency. Requests are signed with AWS Signature V4
  (signed payloads); the signing code is tested against AWS's published examples, and every request in the
  storage tests goes through a local fake S3 server that recomputes the signature.
- **Robustness.** 30-second timeout per request; network errors, `5xx` and `429` are retried twice with backoff
  (all operations are idempotent). Errors report the S3 error code, never the credentials.
- **Moving from local disk:** copy `MEDIA_DIR` into the bucket (keeping the file names, under `S3_PREFIX`), then
  switch `MEDIA_STORAGE`. The database stores only keys, so nothing else changes.

### Cleanup of unused files

Part of the daily job (`cleanupMedia()`):

1. **Unused uploads.** An image is in use while its URL (`/media/<id>.<ext>`, relative or absolute) appears in any
   app – including other apps – or in any undo snapshot (`app_versions`). Unused images older than 7 days are
   deleted (the grace period covers an open editor whose changes are not saved yet), which also frees room under
   the per-app image limit. Images of apps that were saved while the job ran are left for the next run.
2. **Orphaned files.** Stored files without a database row, older than 24 hours – left behind when an upload failed
   halfway or an account was deleted (rows cascade, files do not). Deleting an app removes its files right away.

Rows are deleted before files, so a failure can only leave a file without a row, which the next run removes.
Because the cleanup deletes every file its database does not know, **each environment needs its own folder,
bucket or `S3_PREFIX`** – never point development and production at the same storage.

## Internationalisation

- All platform text lives in `src/i18n/dictionaries.ts`. German (`de`) is the default and the source of truth;
  TypeScript fails the build if the English (`en`) dictionary misses a key.
- Server Components and Server Actions: `const t = await getT()` from `@/i18n/server`.
- Client Components: `const { t, locale } = useI18n()` from `@/i18n/client`.
- The language is stored in the functional `lang` cookie, set by `src/components/SettingsMenu.tsx`.
- Server actions return error *codes* rather than texts, so messages follow a language switch.

## Accounts, e-mail and the daily job

```
src/lib/auth.ts            Better Auth: e-mail confirmation required, password reset, user language
src/lib/mail/mailer.ts     sendMail(): MAIL_PROVIDER=log (outbox, /dev/mail) | smtp (SMTP_URL, MAIL_FROM)
src/lib/mail/templates.ts  German/English mails (plain text + simple HTML, all values escaped)
src/lib/billing/reminders.ts  hosting-expiry reminders
src/lib/jobs/daily.ts      runDailyJobs(): expired credits, stale holds, reminders, media cleanup
```

- **E-mail confirmation.** Signing up sends a confirmation link (valid 24 h); there is no session until it is opened.
  The link signs the user in and leads to `/email-verified`. Signing in with an unconfirmed address sends a new link.
- **Password reset.** `/forgot-password` always answers the same, whether or not an account exists, and mails are
  sent in the background so response times do not reveal it either. The link (valid 1 h, single use) leads to
  `/reset-password`; setting a new password signs the user out on all devices.
- **Language.** Auth mails use the language of the current page; the user's language is also stored (`user.locale`,
  set at sign-up and by the language switch) for mails sent without a request, such as reminders.
- **Hosting reminders** for published sites: 14 days and 3 days before the hosting period ends, when it has ended
  (with the date the site goes offline) and when it went offline. Only the stage that applies today is sent, and each
  stage once per hosting period (unique index on app, stage and `hosted_until`) – a renewal starts a new cycle.
  If sending fails, the reminder is retried on the next run.
- **Daily job.** `npm run jobs:daily` (e.g. a scheduled task in Coolify) or `POST /api/cron/daily` with
  `Authorization: Bearer $CRON_SECRET`. Safe to run more than once a day. It also runs the media cleanup
  ([Cleanup of unused files](#cleanup-of-unused-files)).

## Developer tools

Enabled with `ENABLE_DEV_TOOLS=true` – for local development and supervised demos only:

- **`/dev`** – grant test credits, balances with a ledger check, unit economics (revenue vs. AI cost), recent purchases
- **Simulated checkout** – buying credits or hosting opens `/dev/checkout/<id>`; "Simulate payment" runs the real fulfillment code
- **CLI** – `npm run dev:grant-credits -- demo@example.test 1000 "Demo"`
- **Mail outbox** – `/dev/mail` shows the e-mails `MAIL_PROVIDER=log` would have sent, with their links. It needs no login
  (new accounts must confirm before they can sign in) and therefore only exists on the local development server,
  never in a production build.
- A **TEST MODE** banner is shown on every page while enabled.

## Testing

```bash
npm test
```

Tests run with the Node.js test runner against `TEST_DATABASE_URL` (never the development database) and cover:
parallel reservations, expiry order, stale holds, refunds on failed AI calls and failed saves, idempotent purchases,
hosting states, patch safety (unsafe links, immutable ids), upload validation and metadata stripping, storage path
safety, S3 request signing (AWS test vectors) and the S3 client against a fake server (pagination, retries,
wrong keys), the media cleanup (references in apps, snapshots and other sites; grace periods; orphaned files of
deleted accounts), reference-URL validation, and the Claude provider against a scripted fake API (strict schemas, the
patch tool loop with error feedback, web fetch limits, `pause_turn`, refusals, usage and fallback pricing), Stripe
Checkout and signed webhooks (replays, amount/currency mismatches, delayed payments, expiry, return page), free
preview quotas (parallel claims, per-network, global and budget limits, IP hash retention), the sign-up, confirmation
and password-reset flows through Better Auth, hosting reminders and the daily-job endpoint. No API keys are needed. CI runs the same suite against PostgreSQL on every push and pull request.

## Production readiness checklist

- [ ] Real Impressum and privacy policy for the platform (`src/app/impressum`, `src/app/datenschutz`)
- [ ] Terms of service and data processing agreement (AVV/DPA) linked at sign-up
- [ ] `MAIL_PROVIDER=smtp` with an EU mail provider; SPF, DKIM and DMARC for the sender domain
- [ ] Production values for `ROOT_DOMAIN`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `DATABASE_URL`
- [ ] Wildcard DNS `*.your-domain` and a wildcard TLS certificate
- [ ] Automated, encrypted, off-site backups of the database and media storage
- [ ] PostgreSQL row-level security
- [ ] `ENABLE_DEV_TOOLS` off; `AI_PROVIDER=anthropic`, `PAYMENT_PROVIDER=stripe` with live keys, `MEDIA_STORAGE=s3` with a private EU bucket (or a backed-up volume for `local`)
- [ ] Stripe: webhook endpoint registered (events above), payment methods, business details; decide on VAT/Stripe Tax and invoices; refund handling
- [ ] `TRUST_PROXY_HOPS` matches the proxy setup, so per-network free-preview limits see the real client IP
- [ ] Stripe, Anthropic and the mail provider as processors in the privacy policy and DPA list
- [ ] `npm run jobs:daily` scheduled once a day (or `CRON_SECRET` + an external scheduler)
- [ ] Separate media storage (bucket or `S3_PREFIX`) per environment – the cleanup deletes files its database does not know
