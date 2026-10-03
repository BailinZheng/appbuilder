# Architecture

This document explains how AppBuilder is put together. For setup instructions see the [README](../README.md).

- [Multi-tenancy and routing](#multi-tenancy-and-routing)
- [Site model: blocks instead of code](#site-model-blocks-instead-of-code)
- [Billing core: credits and hosting](#billing-core-credits-and-hosting)
- [AI layer](#ai-layer)
- [Image uploads](#image-uploads)
- [Internationalisation](#internationalisation)
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
  purchases.ts        createPurchase / fulfillPurchase – idempotent, shared by dev checkout and future webhooks
  payment-provider.ts PaymentProvider interface ("dev" = simulated checkout, "stripe" = planned)
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

## AI layer

```
src/lib/ai/
  types.ts           AiProvider interface, site brief, edit requests, token usage
  patches.ts         patch operations returned by the AI + applyPatches() (validated, id/type immutable)
  pricing.ts         model token prices → cost; metered credits
  provider.ts        getAiProvider(): "mock" today, "anthropic" planned
  mock-provider.ts   deterministic demo AI (German/English industry templates, simulated token usage)
  reference-url.ts   normalisation and validation of reference URLs
```

- **Site generation** returns a complete `AppDefinition`; **edits** return a list of patch operations, which keeps
  the expensive output tokens small and every change reviewable.
- **Reference URLs.** The brief may contain the customer's existing website (a source of facts such as services and
  contact details) and a design-inspiration website (a source of style only – colours, layout, tone; never texts,
  images or logos). Both are normalised (`firma.de` → `https://firma.de/`), limited to public http(s) hosts so they
  can never point at internal infrastructure, and stored in `apps.ai_brief`. The planned Claude provider will read
  them with Anthropic's server-side web fetch tool, so the platform itself never fetches arbitrary URLs.

### Replacing the stand-ins

| Stand-in | Replace with | What to implement |
|---|---|---|
| `AI_PROVIDER=mock` | `anthropic` | `AiProvider` with `@anthropic-ai/sdk`: structured output for `generateSite`, strict patch tools (`patchOpSchema`) for `editSite`, prompt caching; return real `usage` |
| `PAYMENT_PROVIDER=dev` | `stripe` | `startCheckout` → Stripe Checkout Session; a webhook route calls `fulfillPurchase(purchaseId, sessionId)` |
| `MEDIA_STORAGE=local` | `s3` | `MediaStorage` for S3-compatible object storage (e.g. an EU region) |

Ledger, prices, server actions, UI and tests stay unchanged.

## Image uploads

```
POST /api/media        session + app ownership required; multipart `file` + `appId`
GET  /media/<id>.webp  public, cached as immutable (IDs are unguessable); served on every host
src/lib/media/
  limits.ts     5 MB per file, 2000 px longest side, 100 images per app, accepted types
  images.ts     type detection from file bytes (JPEG/PNG/WebP/GIF, never SVG); sharp pipeline
  storage.ts    MediaStorage interface; local disk in MEDIA_DIR (default ./data/uploads, git-ignored)
  uploads.ts    saveImageUpload(): validation → processing → storage → database row
```

Every upload is auto-rotated, scaled down to at most 2000 px and re-encoded as WebP. Re-encoding removes all
metadata, including GPS coordinates that phone photos often contain. The editor's `ImageDropzone` supports
drag & drop, click, keyboard and paste, with progress, preview and localised errors.

## Internationalisation

- All platform text lives in `src/i18n/dictionaries.ts`. German (`de`) is the default and the source of truth;
  TypeScript fails the build if the English (`en`) dictionary misses a key.
- Server Components and Server Actions: `const t = await getT()` from `@/i18n/server`.
- Client Components: `const { t, locale } = useI18n()` from `@/i18n/client`.
- The language is stored in the functional `lang` cookie, set by `src/components/SettingsMenu.tsx`.
- Server actions return error *codes* rather than texts, so messages follow a language switch.

## Developer tools

Enabled with `ENABLE_DEV_TOOLS=true` – for local development and supervised demos only:

- **`/dev`** – grant test credits, balances with a ledger check, unit economics (revenue vs. AI cost), recent purchases
- **Simulated checkout** – buying credits or hosting opens `/dev/checkout/<id>`; "Simulate payment" runs the real fulfillment code
- **CLI** – `npm run dev:grant-credits -- demo@example.test 1000 "Demo"`
- A **TEST MODE** banner is shown on every page while enabled.

## Testing

```bash
npm test
```

Tests run with the Node.js test runner against `TEST_DATABASE_URL` (never the development database) and cover:
parallel reservations, expiry order, stale holds, refunds on failed AI calls and failed saves, idempotent purchases,
hosting states, patch safety (unsafe links, immutable ids), upload validation and metadata stripping, storage path
safety, and reference-URL validation. CI runs the same suite against PostgreSQL on every push and pull request.

## Production readiness checklist

- [ ] Real Impressum and privacy policy for the platform (`src/app/impressum`, `src/app/datenschutz`)
- [ ] Terms of service and data processing agreement (AVV/DPA) linked at sign-up
- [ ] E-mail verification and password reset (Better Auth `sendVerificationEmail`)
- [ ] Production values for `ROOT_DOMAIN`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `DATABASE_URL`
- [ ] Wildcard DNS `*.your-domain` and a wildcard TLS certificate
- [ ] Automated, encrypted, off-site backups of the database and media storage
- [ ] PostgreSQL row-level security
- [ ] `ENABLE_DEV_TOOLS` off; real `AI_PROVIDER`, `PAYMENT_PROVIDER` and `MEDIA_STORAGE`
- [ ] Scheduled job for `sweepExpired()` (expired credits, stale holds), hosting-expiry reminder e-mails and cleanup of unused media files
