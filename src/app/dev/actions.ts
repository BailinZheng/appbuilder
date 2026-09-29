"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { addMonths, TEST_CREDIT_VALIDITY_MONTHS } from "@/lib/billing/catalog";
import { grantCredits } from "@/lib/billing/ledger";
import { cancelPurchase, fulfillPurchase } from "@/lib/billing/purchases";
import { devToolsEnabled } from "@/lib/dev-tools";

// Every dev action re-checks the flag – server actions are reachable even if a page is hidden.
function assertDevTools() {
  if (!devToolsEnabled()) throw new Error("Dev tools are disabled");
}

export type GrantState = { ok?: { amount: number; email: string }; error?: string };

export async function grantTestCreditsAction(_prev: GrantState, formData: FormData): Promise<GrantState> {
  assertDevTools();
  await requireUser();
  const userId = String(formData.get("userId") ?? "");
  const amount = Number(formData.get("amount"));
  const note = String(formData.get("note") ?? "").slice(0, 200);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1_000_000) return { error: "amount" };
  const [target] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
  if (!target) return { error: "user" };

  await grantCredits({
    userId: target.id,
    amount,
    source: "test",
    externalRef: `test:ui:${nanoid()}`,
    expiresAt: addMonths(new Date(), TEST_CREDIT_VALIDITY_MONTHS),
    note: note || "Dev tools test grant",
  });
  revalidatePath("/dev");
  revalidatePath("/dashboard", "layout");
  return { ok: { amount, email: target.email } };
}

/** Simulated payment confirmation – takes the same path the Stripe webhook will take later. */
export async function simulatePaymentAction(purchaseId: string) {
  assertDevTools();
  const user = await requireUser();
  const [p] = await db
    .select()
    .from(schema.purchases)
    .where(and(eq(schema.purchases.id, purchaseId), eq(schema.purchases.userId, user.id)));
  if (!p) throw new Error("Purchase not found");
  await fulfillPurchase(p.id, `dev_${nanoid()}`);
  revalidatePath("/dashboard", "layout");
  redirect(p.appId ? `/dashboard/billing?app=${p.appId}#hosting-${p.appId}` : "/dashboard/billing");
}

export async function cancelPaymentAction(purchaseId: string) {
  assertDevTools();
  const user = await requireUser();
  await cancelPurchase(purchaseId, user.id);
  redirect("/dashboard/billing");
}
