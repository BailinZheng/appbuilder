import "server-only";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import { addMonths, getProduct, PURCHASED_CREDIT_VALIDITY_MONTHS } from "./catalog";
import { grantCredits } from "./ledger";

// Purchases are created before payment ("pending") and fulfilled exactly once when the payment
// provider confirms them: today by the simulated dev checkout, later by the Stripe webhook.

const { purchases, apps } = schema;

export class PurchaseError extends Error {
  constructor(readonly code: "unknownProduct" | "appRequired" | "notFound" | "cancelled") {
    super(code);
    this.name = "PurchaseError";
  }
}

export async function createPurchase(input: {
  userId: string;
  productId: string;
  appId?: string | null;
  provider: "dev" | "stripe";
}) {
  const product = getProduct(input.productId);
  if (!product) throw new PurchaseError("unknownProduct");
  if (product.kind === "hosting") {
    if (!input.appId) throw new PurchaseError("appRequired");
    const [app] = await db
      .select({ id: apps.id })
      .from(apps)
      .where(and(eq(apps.id, input.appId), eq(apps.ownerId, input.userId)));
    if (!app) throw new PurchaseError("appRequired");
  }
  const [purchase] = await db
    .insert(purchases)
    .values({
      id: nanoid(),
      userId: input.userId,
      productId: product.id,
      appId: product.kind === "hosting" ? input.appId : null,
      amountCents: product.priceCents,
      provider: input.provider,
    })
    .returning();
  return purchase;
}

/** Idempotent: calling it twice for the same purchase (e.g. a repeated webhook) grants only once. */
export async function fulfillPurchase(purchaseId: string, providerRef?: string) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(purchases).where(eq(purchases.id, purchaseId)).for("update");
    if (!p) throw new PurchaseError("notFound");
    if (p.status === "paid") return { purchase: p, alreadyFulfilled: true };
    if (p.status === "cancelled") throw new PurchaseError("cancelled");

    const product = getProduct(p.productId);
    if (!product) throw new PurchaseError("unknownProduct");
    const now = new Date();

    if (product.kind === "credits") {
      await grantCredits(
        {
          userId: p.userId,
          amount: product.credits,
          source: "purchase",
          externalRef: `purchase:${p.id}`,
          expiresAt: addMonths(now, PURCHASED_CREDIT_VALIDITY_MONTHS),
          note: product.id,
        },
        tx,
      );
    } else {
      const [app] = await tx
        .select({ id: apps.id, hostedUntil: apps.hostedUntil })
        .from(apps)
        .where(and(eq(apps.id, p.appId ?? ""), eq(apps.ownerId, p.userId)))
        .for("update");
      if (!app) throw new PurchaseError("appRequired");
      // Extend from the current end date if still running, otherwise from today.
      const base = app.hostedUntil && app.hostedUntil > now ? app.hostedUntil : now;
      await tx.update(apps).set({ hostedUntil: addMonths(base, product.months) }).where(eq(apps.id, app.id));
    }

    const [paid] = await tx
      .update(purchases)
      .set({ status: "paid", paidAt: now, providerRef: providerRef ?? null })
      .where(eq(purchases.id, p.id))
      .returning();
    return { purchase: paid, alreadyFulfilled: false };
  });
}

export async function cancelPurchase(purchaseId: string, userId: string) {
  await db
    .update(purchases)
    .set({ status: "cancelled" })
    .where(and(eq(purchases.id, purchaseId), eq(purchases.userId, userId), eq(purchases.status, "pending")));
}
