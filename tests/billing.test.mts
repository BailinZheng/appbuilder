// Billing & AI-core tests. Run with `npm test` (uses TEST_DATABASE_URL, never your dev database).
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
process.env.DATABASE_URL = testUrl; // must happen before "@/db" is imported
process.env.ENABLE_DEV_TOOLS = "true";
process.env.MOCK_AI_LATENCY_MS = "0";

const { db, schema } = await import("@/db");
const { sql, eq } = await import("drizzle-orm");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const ledger = await import("@/lib/billing/ledger");
const { runBilledAction } = await import("@/lib/billing/billed-action");
const { createPurchase, fulfillPurchase, cancelPurchase, PurchaseError } = await import("@/lib/billing/purchases");
const { hostingStatus } = await import("@/lib/billing/hosting");
const { addMonths, HOSTING_GRACE_DAYS } = await import("@/lib/billing/catalog");
const { applyPatches, PatchError } = await import("@/lib/ai/patches");
const { mockProvider } = await import("@/lib/ai/mock-provider");
const { creditsForMeteredUsage, costMicroUsd } = await import("@/lib/ai/pricing");
const { emptyLegal } = await import("@/lib/app-definition");

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

async function createUser() {
  const id = `u${++seq}_${Date.now()}`;
  await db.insert(schema.user).values({ id, name: "Test", email: `${id}@example.test` });
  return id;
}

async function createApp(ownerId: string, hostedUntil: Date | null = null) {
  const id = `a${++seq}_${Date.now()}`;
  await db.insert(schema.apps).values({
    id,
    ownerId,
    slug: id.toLowerCase().replace(/_/g, "-"),
    name: "Test App",
    definition: { version: 1, blocks: [] },
    legal: emptyLegal,
    hostedUntil,
  });
  return id;
}

const grant = (userId: string, amount: number, expiresAt: Date | null = null, ref = `test:${++seq}`) =>
  ledger.grantCredits({ userId, amount, source: "test", externalRef: ref, expiresAt });

async function assertInvariant(userId: string) {
  const inv = await ledger.checkLedgerInvariant(userId);
  assert.ok(inv.ok, `ledger invariant broken: ${JSON.stringify(inv)}`);
}

before(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE ai_usage, credit_transactions, credit_holds, credit_lots, purchases, app_versions, submissions, apps, session, account, "user" CASCADE`,
  );
});

after(async () => {
  await db.$client.end();
});

describe("credit ledger", () => {
  test("grants credits and ignores a repeated grant with the same reference", async () => {
    const u = await createUser();
    const first = await grant(u, 500, null, "purchase:abc");
    const again = await grant(u, 500, null, "purchase:abc");
    assert.equal(first.created, true);
    assert.equal(again.created, false);
    assert.equal(await ledger.getBalance(u), 500);
    await assertInvariant(u);
  });

  test("reserve + partial capture charges only the captured amount", async () => {
    const u = await createUser();
    await grant(u, 100);
    const hold = await ledger.reserveCredits({ userId: u, amount: 15, action: "instruction" });
    assert.equal(await ledger.getBalance(u), 85);
    await assertInvariant(u);
    await ledger.captureHold(hold, 9);
    assert.equal(await ledger.getBalance(u), 91);
    const history = await ledger.getHistory(u);
    assert.deepEqual(
      history.map((t) => [t.kind, t.delta]),
      [["charge", -9], ["grant", 100]],
    );
    await assertInvariant(u);
  });

  test("a hold cannot be captured twice", async () => {
    const u = await createUser();
    await grant(u, 50);
    const hold = await ledger.reserveCredits({ userId: u, amount: 10, action: "rewrite" });
    await ledger.captureHold(hold, 10);
    await assert.rejects(ledger.captureHold(hold, 10), ledger.HoldNotActiveError);
    await assert.rejects(ledger.releaseHold(hold), ledger.HoldNotActiveError);
    assert.equal(await ledger.getBalance(u), 40);
  });

  test("rejects reservations above the balance without changing anything", async () => {
    const u = await createUser();
    await grant(u, 20);
    await assert.rejects(
      ledger.reserveCredits({ userId: u, amount: 30, action: "add_section" }),
      (e: unknown) => e instanceof ledger.InsufficientCreditsError && e.available === 20 && e.required === 30,
    );
    assert.equal(await ledger.getBalance(u), 20);
    await assertInvariant(u);
  });

  test("parallel reservations can never overspend", async () => {
    const u = await createUser();
    await grant(u, 60, null);
    await grant(u, 40, new Date(Date.now() + 30 * DAY));
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => ledger.reserveCredits({ userId: u, amount: 30, action: "add_section" })),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const insufficient = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof ledger.InsufficientCreditsError,
    ).length;
    assert.equal(ok, 3);
    assert.equal(insufficient, 7);
    assert.equal(await ledger.getBalance(u), 10);
    await assertInvariant(u);
  });

  test("spends the soonest-expiring credits first and returns them on release", async () => {
    const u = await createUser();
    const never = await grant(u, 100, null);
    const soon = await grant(u, 50, new Date(Date.now() + 10 * DAY));
    const later = await grant(u, 50, new Date(Date.now() + 100 * DAY));
    const hold = await ledger.reserveCredits({ userId: u, amount: 80, action: "redesign" });

    const remaining = async () =>
      Object.fromEntries((await db.select().from(schema.creditLots).where(eq(schema.creditLots.userId, u))).map((l) => [l.id, l.remaining]));
    assert.deepEqual(await remaining(), { [soon.lotId]: 0, [later.lotId]: 20, [never.lotId]: 100 });

    await ledger.releaseHold(hold);
    assert.deepEqual(await remaining(), { [soon.lotId]: 50, [later.lotId]: 50, [never.lotId]: 100 });
    await assertInvariant(u);
  });

  test("expired credits are not spendable and are written off by the sweep", async () => {
    const u = await createUser();
    await grant(u, 70, new Date(Date.now() - DAY));
    await grant(u, 30, null);
    assert.equal(await ledger.getBalance(u), 30);
    await assert.rejects(ledger.reserveCredits({ userId: u, amount: 40, action: "add_section" }), ledger.InsufficientCreditsError);
    const history = await ledger.getHistory(u);
    assert.ok(history.some((t) => t.kind === "expire" && t.delta === -70), "expire transaction missing");
    await assertInvariant(u);
  });

  test("stale holds are released automatically", async () => {
    const u = await createUser();
    await grant(u, 100);
    await ledger.reserveCredits({ userId: u, amount: 40, action: "redesign" });
    assert.equal(await ledger.getBalance(u), 60);
    await ledger.sweepExpired(u, new Date(Date.now() + 60 * 60 * 1000));
    assert.equal(await ledger.getBalance(u), 100);
    await assertInvariant(u);
  });
});

describe("billed actions", () => {
  const usage = { model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 4000, cacheWriteTokens: 0 };

  test("charges the price, records AI usage and commits the result", async () => {
    const u = await createUser();
    await grant(u, 200);
    const { charged, result } = await runBilledAction({
      userId: u,
      action: "redesign",
      reserve: 100,
      provider: "mock",
      compute: async () => ({ output: "done", usage, charge: 100 }),
      commit: async (_tx, output) => `committed:${output}`,
    });
    assert.equal(charged, 100);
    assert.equal(result, "committed:done");
    assert.equal(await ledger.getBalance(u), 100);
    const [row] = await db.select().from(schema.aiUsage).where(eq(schema.aiUsage.userId, u));
    assert.equal(row.creditsCharged, 100);
    assert.equal(row.costMicroUsd, costMicroUsd(usage));
    await assertInvariant(u);
  });

  test("refunds everything when the AI call fails", async () => {
    const u = await createUser();
    await grant(u, 200);
    await assert.rejects(
      runBilledAction({
        userId: u,
        action: "redesign",
        reserve: 100,
        provider: "mock",
        compute: async () => {
          throw new Error("model unavailable");
        },
        commit: async () => undefined,
      }),
      /model unavailable/,
    );
    assert.equal(await ledger.getBalance(u), 200);
    await assertInvariant(u);
  });

  test("rolls back the charge when saving the result fails", async () => {
    const u = await createUser();
    await grant(u, 200);
    await assert.rejects(
      runBilledAction({
        userId: u,
        action: "redesign",
        reserve: 100,
        provider: "mock",
        compute: async () => ({ output: 1, usage, charge: 100 }),
        commit: async () => {
          throw new Error("disk full");
        },
      }),
      /disk full/,
    );
    assert.equal(await ledger.getBalance(u), 200);
    assert.equal((await ledger.getHistory(u)).filter((t) => t.kind === "charge").length, 0);
    assert.equal((await db.select().from(schema.aiUsage).where(eq(schema.aiUsage.userId, u))).length, 0);
    await assertInvariant(u);
  });

  test("a zero charge (nothing useful happened) costs nothing and skips commit", async () => {
    const u = await createUser();
    await grant(u, 50);
    let committed = false;
    const { charged } = await runBilledAction({
      userId: u,
      action: "instruction",
      reserve: 15,
      provider: "mock",
      compute: async () => ({ output: null, usage, charge: 0 }),
      commit: async () => {
        committed = true;
      },
    });
    assert.equal(charged, 0);
    assert.equal(committed, false);
    assert.equal(await ledger.getBalance(u), 50);
    await assertInvariant(u);
  });
});

describe("purchases", () => {
  test("a credit pack is granted exactly once, even if confirmed twice", async () => {
    const u = await createUser();
    const p = await createPurchase({ userId: u, productId: "credits_2750", provider: "dev" });
    assert.equal(p.status, "pending");
    assert.equal(await ledger.getBalance(u), 0);
    const first = await fulfillPurchase(p.id, "ref_1");
    const second = await fulfillPurchase(p.id, "ref_1");
    assert.equal(first.alreadyFulfilled, false);
    assert.equal(second.alreadyFulfilled, true);
    assert.equal(await ledger.getBalance(u), 2750);
    await assertInvariant(u);
  });

  test("a hosting pass extends from the current end date", async () => {
    const u = await createUser();
    const end = new Date(Date.now() + 10 * DAY);
    const appId = await createApp(u, end);
    const p = await createPurchase({ userId: u, productId: "hosting_3m", appId, provider: "dev" });
    await fulfillPurchase(p.id);
    const [app] = await db.select().from(schema.apps).where(eq(schema.apps.id, appId));
    assert.equal(app.hostedUntil?.getTime(), addMonths(end, 3).getTime());
  });

  test("hosting passes need an app owned by the buyer; cancelled purchases are never fulfilled", async () => {
    const owner = await createUser();
    const other = await createUser();
    const appId = await createApp(owner);
    await assert.rejects(createPurchase({ userId: other, productId: "hosting_12m", appId, provider: "dev" }), PurchaseError);
    const p = await createPurchase({ userId: owner, productId: "credits_1000", provider: "dev" });
    await cancelPurchase(p.id, owner);
    await assert.rejects(fulfillPurchase(p.id), PurchaseError);
    assert.equal(await ledger.getBalance(owner), 0);
  });
});

describe("hosting status", () => {
  test("active → grace → lapsed", () => {
    const now = new Date();
    assert.equal(hostingStatus(null, now).state, "none");
    assert.equal(hostingStatus(new Date(now.getTime() + DAY), now).state, "active");
    assert.equal(hostingStatus(new Date(now.getTime() - DAY), now).state, "grace");
    assert.equal(hostingStatus(new Date(now.getTime() - (HOSTING_GRACE_DAYS + 1) * DAY), now).state, "lapsed");
  });
});

describe("AI core", () => {
  const brief = { businessName: "Bäckerei Test", industry: "bakery", city: "Berlin", services: "Brot, Brötchen", tone: "friendly", phone: "+49 30 123" } as const;

  test("mock generation produces a valid site", async () => {
    const { output, usage } = await mockProvider.generateSite(brief, "de");
    assert.equal(output.name, "Bäckerei Test");
    assert.ok(output.definition.blocks.some((b) => b.type === "contact"));
    assert.ok(usage.outputTokens > 0);
    // Round-trip through the validator
    assert.deepEqual(applyPatches(output, []).definition, output.definition);
  });

  test("every edit kind yields valid patches", async () => {
    const site = (await mockProvider.generateSite(brief, "en")).output;
    for (const request of [
      { kind: "redesign" },
      { kind: "add_section", section: "faq" },
      { kind: "rewrite", tone: "shorter" },
      { kind: "instruction", text: "make it blue" },
    ] as const) {
      const { output } = await mockProvider.editSite(site, request, "en");
      assert.ok(output.ops.length > 0, `${request.kind} returned no ops`);
      applyPatches(site, output.ops);
    }
    const unknown = await mockProvider.editSite(site, { kind: "instruction", text: "xyz" }, "en");
    assert.equal(unknown.output.ops.length, 0);
  });

  test("patches cannot inject unsafe links or touch unknown blocks", async () => {
    const site = (await mockProvider.generateSite(brief, "en")).output;
    const button = site.definition.blocks.find((b) => b.type === "button")!;
    assert.throws(() => applyPatches(site, [{ op: "update_block", id: button.id, fields: { href: "javascript:alert(1)" } }]), PatchError);
    assert.throws(() => applyPatches(site, [{ op: "remove_block", id: "nope" }]), PatchError);
    assert.throws(() => applyPatches(site, [{ op: "set_theme", themeColor: "red" }]));
    const patched = applyPatches(site, [{ op: "update_block", id: button.id, fields: { id: "x", type: "hero", label: "Hi" } }]);
    const same = patched.definition.blocks.find((b) => b.id === button.id);
    assert.equal(same?.type, "button", "block id/type must be immutable");
  });

  test("metered credits stay within the advertised range", () => {
    assert.equal(creditsForMeteredUsage(0), 5);
    assert.equal(creditsForMeteredUsage(30_000), 9);
    assert.equal(creditsForMeteredUsage(10_000_000), 15);
  });
});
