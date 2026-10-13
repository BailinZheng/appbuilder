// Stripe Checkout/webhook and free-preview quota tests. Run with `npm test` (uses TEST_DATABASE_URL).
// No Stripe account or key is needed: the Stripe API is faked and webhooks are signed locally.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
process.env.DATABASE_URL = testUrl;
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
process.env.BETTER_AUTH_URL = "https://app.example.test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-for-ip-hashing";
delete process.env.FREE_PREVIEW_DAILY_LIMIT;
delete process.env.FREE_PREVIEW_DAILY_BUDGET_USD;

const Stripe = (await import("stripe")).default;
const { db, schema } = await import("@/db");
const { sql, eq } = await import("drizzle-orm");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const { createPurchase } = await import("@/lib/billing/purchases");
const { getBalance } = await import("@/lib/billing/ledger");
const { startStripeCheckout, syncCheckoutSession } = await import("@/lib/billing/stripe");
const { POST: webhook } = await import("@/app/api/stripe/webhook/route");
const { runFreePreview, hasFreePreview, FreePreviewError } = await import("@/lib/billing/free-preview");
const { clientIp, hashIp, ipNetwork } = await import("@/lib/client-ip");
const { emptyLegal } = await import("@/lib/app-definition");

let seq = 0;
async function createUser() {
  const id = `pu${++seq}_${Date.now()}`;
  await db.insert(schema.user).values({ id, name: "Pay", email: `${id}@example.test` });
  return id;
}

before(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE hosting_reminders, free_previews, media, ai_usage, credit_transactions, credit_holds, credit_lots, purchases, app_versions, submissions, apps, session, account, "user"`,
  );
});

after(async () => {
  await db.$client.end();
});

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

type Session = import("stripe").Stripe.Checkout.Session;

let sessionSeq = 0;
function fakeStripe(sessions: Record<string, Partial<Session>> = {}) {
  const calls: { params: Record<string, unknown>; options?: { idempotencyKey?: string }; id: string }[] = [];
  return {
    calls,
    checkout: {
      sessions: {
        create: async (params: object, options?: { idempotencyKey?: string }) => {
          const id = `cs_test_${++sessionSeq}`;
          calls.push({ params: params as Record<string, unknown>, options, id });
          return { id, url: `https://checkout.stripe.com/c/pay/${id}` } as Session;
        },
        retrieve: async (id: string) => ({ id, ...sessions[id] }) as Session,
      },
    },
  };
}

/** A checkout.session.* event with a valid signature, delivered to the webhook route. */
async function deliver(type: string, session: Partial<Session>, secret = process.env.STRIPE_WEBHOOK_SECRET!) {
  const payload = JSON.stringify({ id: `evt_${++seq}`, object: "event", type, data: { object: { object: "checkout.session", ...session } } });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return webhook(new Request("https://app.example.test/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": signature } }));
}

async function stripePurchase(userId: string, productId = "credits_1000", appId: string | null = null) {
  const purchase = await createPurchase({ userId, productId, appId, provider: "stripe" });
  const stripe = fakeStripe();
  await startStripeCheckout(stripe, purchase, { email: "pay@example.test", locale: "de", productName: "AppBuilder · 1.000 Credits" });
  return { purchase, stripe, sessionId: stripe.calls[0].id };
}

const paidSession = (purchaseId: string, amount: number, id: string): Partial<Session> => ({
  id,
  mode: "payment",
  payment_status: "paid",
  amount_total: amount,
  currency: "eur",
  client_reference_id: purchaseId,
});

describe("Stripe Checkout", () => {
  test("creates a session priced from our purchase, idempotent per purchase", async () => {
    const u = await createUser();
    const { purchase, stripe } = await stripePurchase(u, "credits_2750");
    const [{ params, options, id }] = stripe.calls;
    assert.equal(options?.idempotencyKey, `checkout:${purchase.id}`);
    assert.equal(params.mode, "payment");
    assert.equal(params.client_reference_id, purchase.id);
    assert.deepEqual((params.line_items as { price_data: object }[])[0].price_data, {
      currency: "eur",
      unit_amount: 2500,
      product_data: { name: "AppBuilder · 1.000 Credits" },
    });
    assert.match(String(params.success_url), /^https:\/\/app\.example\.test\/dashboard\/billing\?checkout=success&session_id=\{CHECKOUT_SESSION_ID\}$/);
    const [row] = await db.select().from(schema.purchases).where(eq(schema.purchases.id, purchase.id));
    assert.equal(row.providerRef, id);
    assert.equal(row.status, "pending");
  });

  test("a signed checkout.session.completed grants the credits exactly once", async () => {
    const u = await createUser();
    const { purchase, sessionId } = await stripePurchase(u);
    const first = await deliver("checkout.session.completed", paidSession(purchase.id, 1000, sessionId));
    assert.equal(first.status, 200);
    assert.equal((await first.json()).result, "fulfilled");
    const again = await deliver("checkout.session.completed", paidSession(purchase.id, 1000, sessionId)); // Stripe retries
    assert.equal((await again.json()).result, "alreadyFulfilled");
    assert.equal(await getBalance(u), 1000);
    const [row] = await db.select().from(schema.purchases).where(eq(schema.purchases.id, purchase.id));
    assert.equal(row.status, "paid");
  });

  test("rejects unsigned or wrongly signed requests", async () => {
    const u = await createUser();
    const { purchase, sessionId } = await stripePurchase(u);
    assert.equal((await deliver("checkout.session.completed", paidSession(purchase.id, 1000, sessionId), "whsec_wrong")).status, 400);
    const unsigned = await webhook(new Request("https://app.example.test/api/stripe/webhook", { method: "POST", body: "{}" }));
    assert.equal(unsigned.status, 400);
    assert.equal(await getBalance(u), 0);
  });

  test("never fulfils a session whose amount or currency differs from the purchase", async () => {
    const u = await createUser();
    const { purchase, sessionId } = await stripePurchase(u, "credits_6000");
    const cheap = await deliver("checkout.session.completed", paidSession(purchase.id, 1000, sessionId));
    assert.equal((await cheap.json()).result, "mismatch");
    const usd = await deliver("checkout.session.completed", { ...paidSession(purchase.id, 5000, sessionId), currency: "usd" });
    assert.equal((await usd.json()).result, "mismatch");
    const otherSession = await deliver("checkout.session.completed", paidSession(purchase.id, 5000, "cs_test_other"));
    assert.equal((await otherSession.json()).result, "mismatch");
    assert.equal(await getBalance(u), 0);
  });

  test("delayed payment methods: waits for async_payment_succeeded, cancels on failure or expiry", async () => {
    const u = await createUser();
    const { purchase, sessionId } = await stripePurchase(u);
    const unpaid = await deliver("checkout.session.completed", { ...paidSession(purchase.id, 1000, sessionId), payment_status: "unpaid" });
    assert.equal((await unpaid.json()).result, "pending");
    assert.equal(await getBalance(u), 0);
    await deliver("checkout.session.async_payment_succeeded", paidSession(purchase.id, 1000, sessionId));
    assert.equal(await getBalance(u), 1000);

    const failed = await stripePurchase(u);
    await deliver("checkout.session.async_payment_failed", { ...paidSession(failed.purchase.id, 1000, failed.sessionId), payment_status: "unpaid" });
    const expired = await createPurchase({ userId: u, productId: "credits_1000", provider: "stripe" });
    await deliver("checkout.session.expired", { client_reference_id: expired.id, payment_status: "unpaid" });
    const rows = await db.select().from(schema.purchases);
    assert.equal(rows.find((r) => r.id === failed.purchase.id)?.status, "cancelled");
    assert.equal(rows.find((r) => r.id === expired.id)?.status, "cancelled");
    assert.equal(await getBalance(u), 1000);
  });

  test("hosting passes extend the app's hosting period", async () => {
    const u = await createUser();
    const appId = `pa${++seq}`;
    await db.insert(schema.apps).values({ id: appId, ownerId: u, slug: `pay-app-${seq}`, name: "Pay App", definition: { version: 1, blocks: [] }, legal: emptyLegal });
    const { purchase, sessionId } = await stripePurchase(u, "hosting_3m", appId);
    await deliver("checkout.session.completed", paidSession(purchase.id, 1500, sessionId));
    const [app] = await db.select().from(schema.apps).where(eq(schema.apps.id, appId));
    assert.ok(app.hostedUntil && app.hostedUntil.getTime() > Date.now() + 80 * 24 * 60 * 60 * 1000);
  });

  test("return from Checkout fulfils for the buyer only", async () => {
    const buyer = await createUser();
    const stranger = await createUser();
    const { purchase, sessionId } = await stripePurchase(buyer);
    const stripe = fakeStripe({ [sessionId]: paidSession(purchase.id, 1000, sessionId) });
    assert.equal(await syncCheckoutSession(stripe, sessionId, stranger), "unknownPurchase");
    assert.equal(await syncCheckoutSession(stripe, "not-a-session", buyer), "unknownPurchase");
    assert.equal(await syncCheckoutSession(stripe, sessionId, buyer), "fulfilled");
    assert.equal(await getBalance(buyer), 1000);
    assert.equal(await getBalance(stranger), 0);
  });
});

// ---------------------------------------------------------------------------
// Free AI preview
// ---------------------------------------------------------------------------

const usage = { model: "claude-opus-5-5", inputTokens: 5000, outputTokens: 3000, cacheReadTokens: 0, cacheWriteTokens: 0 }; // $0.08

async function preview(userId: string, ipHash: string | null, opts: { fail?: boolean } = {}) {
  const appId = `fp${++seq}`;
  return runFreePreview({
    userId,
    ipHash,
    appId,
    provider: "mock",
    compute: async () => {
      if (opts.fail) throw new Error("AI down");
      return { output: { name: "Free" }, usage };
    },
    commit: async (tx, output) => {
      await tx.insert(schema.apps).values({ id: appId, ownerId: userId, slug: `free-${seq}`, name: output.name, definition: { version: 1, blocks: [] }, legal: emptyLegal });
      return appId;
    },
  });
}

const denial = (code: string) => (e: unknown) => e instanceof FreePreviewError && e.code === code;

describe("free AI preview", () => {
  test("the first site is free: no credits, usage recorded, then it is used up", async () => {
    const u = await createUser();
    assert.equal(await hasFreePreview(u), true);
    const { result: appId } = await preview(u, "ip-a");
    assert.equal(await hasFreePreview(u), false);
    await assert.rejects(preview(u, "ip-b"), denial("used"));

    const [usageRow] = await db.select().from(schema.aiUsage);
    assert.equal(usageRow.action, "free_preview");
    assert.equal(usageRow.creditsCharged, 0);
    assert.equal(usageRow.costMicroUsd, 80_000);
    assert.equal((await db.select().from(schema.creditTransactions)).length, 0);
    const [slot] = await db.select().from(schema.freePreviews).where(eq(schema.freePreviews.status, "succeeded"));
    assert.equal(slot.appId, appId);
  });

  test("a failed AI call does not use up the user's preview", async () => {
    const u = await createUser();
    await assert.rejects(preview(u, "ip-a", { fail: true }), /AI down/);
    assert.equal(await hasFreePreview(u), true);
    await preview(u, "ip-a");
    assert.equal((await db.select().from(schema.apps)).length, 1);
  });

  test("parallel requests from one user get only one free preview", async () => {
    const u = await createUser();
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => preview(u, `ip-${i}`)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  });

  test("per-IP limit: 3 per day across accounts, failed attempts included", async () => {
    await preview(await createUser(), "same-net", { fail: true }).catch(() => {});
    await preview(await createUser(), "same-net");
    await preview(await createUser(), "same-net");
    await assert.rejects(preview(await createUser(), "same-net"), denial("ipLimit"));
    await preview(await createUser(), "other-net");
  });

  test("global daily limit and budget; 0 switches free previews off", async () => {
    process.env.FREE_PREVIEW_DAILY_LIMIT = "2";
    try {
      await preview(await createUser(), "n1");
      await preview(await createUser(), "n2");
      await assert.rejects(preview(await createUser(), "n3"), denial("unavailable"));
    } finally {
      delete process.env.FREE_PREVIEW_DAILY_LIMIT;
    }

    process.env.FREE_PREVIEW_DAILY_BUDGET_USD = "0.4"; // already spent $0.16, plus the $0.30 estimate for the next one
    try {
      await assert.rejects(preview(await createUser(), "n4"), denial("unavailable"));
    } finally {
      delete process.env.FREE_PREVIEW_DAILY_BUDGET_USD;
    }

    process.env.FREE_PREVIEW_DAILY_LIMIT = "0";
    try {
      assert.equal(await hasFreePreview(await createUser()), false);
    } finally {
      delete process.env.FREE_PREVIEW_DAILY_LIMIT;
    }
  });

  test("IP hashes are deleted after two days", async () => {
    const u = await createUser();
    await db.insert(schema.freePreviews).values({ id: "old", userId: u, ipHash: "x", status: "failed", createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) });
    await preview(u, "fresh");
    const rows = await db.select().from(schema.freePreviews);
    assert.equal(rows.find((r) => r.id === "old")?.ipHash, null);
    assert.equal(rows.find((r) => r.id !== "old")?.ipHash, "fresh");
  });
});

describe("client IP", () => {
  test("trusts only the entry added by the proxy and groups IPv6 by /64", () => {
    const h = (xff: string) => new Headers({ "x-forwarded-for": xff });
    assert.equal(clientIp(h("6.6.6.6, 203.0.113.7")), "203.0.113.7", "left entries are client-controlled");
    assert.equal(clientIp(h("203.0.113.7:51234")), "203.0.113.7");
    assert.equal(clientIp(h("not-an-ip")), null);
    process.env.TRUST_PROXY_HOPS = "0";
    try {
      assert.equal(clientIp(h("203.0.113.7")), null);
    } finally {
      delete process.env.TRUST_PROXY_HOPS;
    }

    assert.equal(ipNetwork("2001:db8:1:2:aaaa::1"), "2001:db8:1:2::/64");
    assert.equal(ipNetwork("2001:db8:1:2:bbbb:cccc:dddd:eeee"), "2001:db8:1:2::/64");
    assert.equal(ipNetwork("2001:db8::1"), "2001:db8:0:0::/64");
    assert.equal(ipNetwork("::ffff:203.0.113.7"), "203.0.113.7");
    assert.equal(hashIp("2001:db8:1:2::1"), hashIp("2001:db8:1:2:ffff::9"));
    assert.notEqual(hashIp("203.0.113.7"), hashIp("203.0.113.8"));
    assert.doesNotMatch(hashIp("203.0.113.7")!, /203/);
    assert.equal(hashIp(null), null);
  });
});
