# AppBuilder

No-code app builder for self-employed people and small businesses. Each customer app is stored as a
JSON definition and rendered by one shared engine. It is served on its own subdomain and is installable as a PWA.

## Stack

| Layer     | Tech                                              |
|-----------|---------------------------------------------------|
| Framework | Next.js 16 (App Router) · React 19 · TypeScript   |
| Styling   | Tailwind CSS 4                                    |
| Database  | PostgreSQL 18 · Drizzle ORM (migrations in `drizzle/`) |
| Auth      | Better Auth (email + password, self-hosted, telemetry off) |
| Validation| Zod                                               |

## Run locally

Requirements (already installed on this machine): Node.js 24 LTS, Git, PostgreSQL 18 (Windows service `postgresql-x64-18`).

```bash
npm install
cp .env.example .env     # then fill in DATABASE_URL and BETTER_AUTH_SECRET
npm run dev              # applies DB migrations, then starts http://localhost:3000
```

- Platform / dashboard: http://localhost:3000
- A published customer app: `http://<slug>.localhost:3000` (also reachable at `/s/<slug>`)

## Scripts

| Command               | What it does                                           |
|-----------------------|--------------------------------------------------------|
| `npm run dev`         | Migrate DB + start dev server                          |
| `npm run build`       | Production build (standalone output for Docker)        |
| `npm run typecheck`   | TypeScript check                                       |
| `npm run lint`        | ESLint                                                 |
| `npm run db:generate` | Create a SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate`  | Apply migrations to `DATABASE_URL`                     |
| `npm run db:studio`   | Browse the database in the browser                     |
| `npm test`            | Billing & AI-core tests (separate test database)       |
| `npm run dev:grant-credits -- <email> <n>` | Grant test credits (dev tools only) |

## Project layout

```
src/
  proxy.ts                  subdomain → /s/<slug> routing (multi-tenant)
  db/schema.ts              all tables (auth, apps, submissions)
  lib/app-definition.ts     the JSON format of a customer app (blocks) + validation
  lib/auth.ts               Better Auth config, requireUser()
  components/AppRenderer    renders an app definition (public site + editor preview)
  app/dashboard/            customer dashboard, editor, messages, server actions
  app/s/[slug]/             public customer app: page, Impressum, Datenschutz,
                            PWA manifest, generated icon, contact-form action
public/sw.js                shared service worker (offline + installable)
```

## Adding a new block type

1. Add it to `blockSchema`, `BLOCK_TYPES`, `STARTER` and `newBlock()` in `src/lib/app-definition.ts`
2. Add its name to `editor.blocks` (and any field labels to `editor.fields`) in **both** languages in `src/i18n/dictionaries.ts`
3. Render it in `BlockView` (`src/components/AppRenderer.tsx`)
4. Add its fields in `BlockFields` (`src/app/dashboard/apps/[id]/editor.tsx`)

## Translations (German / English)

- All platform text lives in `src/i18n/dictionaries.ts`. German (`de`) is the default and the source of truth;
  TypeScript reports an error if the English (`en`) dictionary is missing a key.
- Server Components / Server Actions: `const t = await getT()` from `@/i18n/server`
- Client Components: `const { t, locale } = useI18n()` from `@/i18n/client`
- The chosen language is stored in the `lang` cookie (set by the settings menu, `src/components/SettingsMenu.tsx`).

## Credits, hosting & AI (billing core)

Pay-as-you-go credits for AI actions, one-time hosting passes for going online. Everything is real
production code except two clearly separated stand-ins: the **mock AI provider** and the **simulated checkout**.

```
src/lib/billing/
  catalog.ts          prices, credit packs, hosting passes (the ONLY place prices live; bump PRICE_LIST_VERSION)
  ledger.ts           credit lots, reserve → capture | release, expiry, history, invariant check
  billed-action.ts    runBilledAction(): reserve → AI call → charge + save result in ONE transaction
  purchases.ts        createPurchase / fulfillPurchase (idempotent – shared by dev checkout and future Stripe webhook)
  payment-provider.ts PaymentProvider interface; "dev" = simulated checkout, "stripe" = TODO
  hosting.ts          hosting status (active / 14-day grace / lapsed = offline, never deleted)
src/lib/ai/
  types.ts            AiProvider interface, site brief, edit requests, token usage
  patches.ts          patch operations the AI returns + safe applyPatches() (validated, XSS-safe)
  pricing.ts          model token prices → cost; metered credits (cost × markup, clamped)
  provider.ts         getAiProvider(); "mock" today, "anthropic" = TODO
  mock-provider.ts    deterministic demo AI (DE/EN industry templates, simulated token usage)
```

**How charging works:** credits are *reserved* before an AI call (row-locked, can never go negative, parallel
requests can't double-spend), then *captured* together with saving the result in one database transaction.
If the AI call fails, returns nothing useful, or saving fails, the reservation is released – the user pays
if and only if they get the result. Every AI change is snapshotted, so **undo is always free**.

**Invariant** (checked by tests and shown on /dev): `SUM(credit_transactions) = SUM(lot remaining) + SUM(active holds)`.

### Dev/demo tools (`ENABLE_DEV_TOOLS=true` in `.env`)

- **/dev** – grant test credits to any user, balances with ledger check, unit economics (revenue vs. AI cost), recent purchases
- **Simulated checkout** – buying credits or hosting opens `/dev/checkout/<id>` instead of Stripe; "Simulate payment" runs the real fulfillment code
- **CLI:** `npm run dev:grant-credits -- demo@example.test 1000 "Investor demo"`
- A yellow **TEST MODE** banner is shown on every page while enabled. Never enable on a real production server.

### Replacing the stand-ins later

| Stand-in | Replace with | What to implement |
|---|---|---|
| `AI_PROVIDER=mock` | `anthropic` | `AiProvider` with `@anthropic-ai/sdk`: structured output for `generateSite`, strict patch tools (`patchOpSchema`) for `editSite`, prompt caching; return real `response.usage` |
| `PAYMENT_PROVIDER=dev` | `stripe` | `startCheckout` → Stripe Checkout Session; webhook route calls `fulfillPurchase(purchaseId, sessionId)` |

Nothing else changes: ledger, prices, actions, UI and tests stay as they are.

## Image uploads

The image block uses a drag & drop upload area (`src/components/ImageDropzone.tsx`, also click, keyboard and paste).

```
POST /api/media        login + app ownership required; multipart `file` + `appId`
GET  /media/<id>.webp  public, cached forever (IDs are unguessable); works on every customer subdomain
src/lib/media/
  limits.ts     5 MB per file, 2000 px longest side, 100 images per app, accepted types
  images.ts     real type detection from file bytes (no SVG), sharp: rotate, resize, re-encode to WebP
                → strips all metadata incl. GPS location (GDPR)
  storage.ts    MediaStorage interface: local disk (MEDIA_DIR, default ./data/uploads – git-ignored);
                S3 / Hetzner Object Storage = TODO
  uploads.ts    saveImageUpload(): validation, processing, storage, database row
```

TODO before launch: delete files of removed images/apps (rows cascade, files on disk stay) and back up the media storage.

## AI reference URLs

The "Create with AI" form has two optional fields: the customer's **existing website** (source for facts like
services and contact details) and a **design inspiration** website (source for style only – colours, layout, tone;
never texts, images or logos). Both are normalised (`firma.de` → `https://firma.de/`), restricted to public
http(s) addresses (`src/lib/ai/reference-url.ts`) and stored with the app in `apps.ai_brief`.
The mock AI only borrows a colour from the inspiration site; the real provider will read both pages via
Anthropic's server-side web fetch (see `src/lib/ai/provider.ts`).

### Tests

```bash
npm test
```
Runs against `TEST_DATABASE_URL` (a separate database, `appbuilder_test`) – never your dev data. Covers
concurrency, expiry order, refunds on failure, idempotent purchases, hosting states, patch safety and the mock AI.

## Before going live (checklist)

- [ ] Real Impressum and Datenschutzerklärung for the platform (`src/app/impressum`, `src/app/datenschutz`)
- [ ] AGB and AVV (data processing agreement) documents linked at sign-up
- [ ] E-mail verification and password reset (Better Auth `sendVerificationEmail`, e.g. via Brevo)
- [ ] `ROOT_DOMAIN`, `BETTER_AUTH_URL`, strong `BETTER_AUTH_SECRET` and `DATABASE_URL` in production
- [ ] Wildcard DNS `*.yourdomain` → server, wildcard TLS certificate
- [ ] Automated, encrypted, off-site database backups
- [ ] Postgres row-level security as a second layer of tenant isolation
- [ ] `ENABLE_DEV_TOOLS` removed/false, real `AI_PROVIDER` and `PAYMENT_PROVIDER` configured
- [ ] Scheduled job calling `sweepExpired()` (expired credits, stale holds) and hosting-expiry reminder e-mails
