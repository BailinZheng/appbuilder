import "server-only";
import type { Purchase } from "@/db/schema";
import { devToolsEnabled } from "@/lib/dev-tools";

/**
 * Payment provider abstraction. The app only ever calls `startCheckout` and later receives a
 * confirmation that calls `fulfillPurchase(purchaseId)`.
 *
 * - "dev":    simulated checkout page at /dev/checkout/<id> (requires ENABLE_DEV_TOOLS=true)
 * - "stripe": TODO – create a Stripe Checkout Session here and call fulfillPurchase()
 *             from the `checkout.session.completed` webhook (route handler under /api/stripe).
 */
export interface PaymentProvider {
  readonly id: "dev" | "stripe";
  startCheckout(purchase: Purchase): Promise<{ redirectUrl: string }>;
}

const devProvider: PaymentProvider = {
  id: "dev",
  async startCheckout(purchase) {
    return { redirectUrl: `/dev/checkout/${purchase.id}` };
  },
};

export function getPaymentProvider(): PaymentProvider {
  const id = process.env.PAYMENT_PROVIDER ?? "dev";
  if (id === "dev") {
    if (!devToolsEnabled()) throw new Error("PAYMENT_PROVIDER=dev requires ENABLE_DEV_TOOLS=true");
    return devProvider;
  }
  throw new Error(`Payment provider "${id}" is not implemented yet`);
}
