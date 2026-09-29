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

1. Add it to `blockSchema`, `BLOCK_LABELS` and `newBlock()` in `src/lib/app-definition.ts`
2. Render it in `BlockView` (`src/components/AppRenderer.tsx`)
3. Add its fields in `BlockFields` (`src/app/dashboard/apps/[id]/editor.tsx`)

## Before going live (checklist)

- [ ] Real Impressum and Datenschutzerklärung for the platform (`src/app/impressum`, `src/app/datenschutz`)
- [ ] AGB and AVV (data processing agreement) documents linked at sign-up
- [ ] E-mail verification and password reset (Better Auth `sendVerificationEmail`, e.g. via Brevo)
- [ ] `ROOT_DOMAIN`, `BETTER_AUTH_URL`, strong `BETTER_AUTH_SECRET` and `DATABASE_URL` in production
- [ ] Wildcard DNS `*.yourdomain` → server, wildcard TLS certificate
- [ ] Automated, encrypted, off-site database backups
- [ ] Postgres row-level security as a second layer of tenant isolation
