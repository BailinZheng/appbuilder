# Contributing to AppBuilder

Thanks for your interest in improving AppBuilder! Bug reports, feature ideas, documentation fixes and code
contributions are all welcome.

## Ways to contribute

- **Report a bug** – open an issue using the *Bug report* template. Include steps to reproduce and what you expected.
- **Suggest a feature** – open an issue using the *Feature request* template and describe the problem it solves.
- **Improve the docs** – typos, unclear setup steps and missing explanations are great first contributions.
- **Write code** – look for issues labelled `good first issue` or `help wanted`, or open an issue first for larger changes
  so we can agree on the approach before you invest time.

Security vulnerabilities must **not** be reported in public issues – see [SECURITY.md](SECURITY.md).

## Development setup

Follow the [Quick start](README.md#quick-start) in the README. You need Node.js 24 LTS and PostgreSQL 16+.
Create both databases from `.env.example` (`DATABASE_URL` and `TEST_DATABASE_URL`) and set `ENABLE_DEV_TOOLS=true`
locally so you can grant yourself test credits.

The architecture is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – reading it first will save you time.

## Making a change

1. Fork the repository and create a branch from `main`: `git checkout -b fix/short-description`
2. Make your change, keeping it focused – one topic per pull request.
3. Run all checks locally:

   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```

4. Commit with a clear message in the imperative mood, e.g. `Add FAQ block type` or `Fix hosting grace period for lapsed sites`.
5. Open a pull request and fill in the template. CI runs the same checks automatically.

## Guidelines

- **TypeScript strict, no `any`** unless there is no reasonable alternative.
- **Validate at the boundary.** Every server action and route handler validates its input (Zod) and re-checks
  the session and ownership – never rely on the UI or `proxy.ts` alone.
- **Database changes** go through `src/db/schema.ts` and a generated migration (`npm run db:generate`).
  Never edit an existing migration that has been merged.
- **Money and credits** only move through `src/lib/billing/ledger.ts` / `runBilledAction`. Changes there need tests.
- **Prices** live only in `src/lib/billing/catalog.ts`; bump `PRICE_LIST_VERSION` when you change one.
- **User-facing text** goes into `src/i18n/dictionaries.ts` in **both** German and English.
- **Tests** – add or update tests for behaviour changes, especially in `src/lib/`.
- **Privacy** – don't add trackers, third-party scripts or new data processing without discussing it in an issue first.
- **Secrets** – never commit `.env` files, keys or real customer data. Use `.env.example` with placeholders.

## License of contributions

AppBuilder is licensed under the [AGPL-3.0-or-later](LICENSE). By submitting a contribution, you agree that it is
licensed under the same terms.
