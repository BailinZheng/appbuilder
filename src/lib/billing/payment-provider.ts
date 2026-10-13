import "server-only";
import type { Purchase } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { devToolsEnabled } from "@/lib/dev-tools";
import { getStripe, startStripeCheckout } from "./stripe";

/**
 * Payment provider abstraction. The app only ever calls `startCheckout` and later receives a
 * confirmation that calls `fulfillPurchase(purchaseId)`.
 *
 * - "dev":    simulated checkout page at /dev/checkout/<id> (requires ENABLE_DEV_TOOLS=true)
 * - "stripe": Stripe Checkout; confirmed by the webhook at /api/stripe/webhook and on return to the
 *             billing page (see stripe.ts). Needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.
 */
export type CheckoutContext = { email: string; locale: Locale; productName: string };

export interface PaymentProvider {
  readonly id: "dev" | "stripe";
  startCheckout(purchase: Purchase, ctx: CheckoutContext): Promise<{ redirectUrl: string }>;
}

const devProvider: PaymentProvider = {
  id: "dev",
  async startCheckout(purchase) {
    return { redirectUrl: `/dev/checkout/${purchase.id}` };
  },
};

const stripeProvider: PaymentProvider = {
  id: "stripe",
  startCheckout: (purchase, ctx) => startStripeCheckout(getStripe(), purchase, ctx),
};

export function getPaymentProvider(): PaymentProvider {
  const id = process.env.PAYMENT_PROVIDER ?? "dev";
  if (id === "dev") {
    if (!devToolsEnabled()) throw new Error("PAYMENT_PROVIDER=dev requires ENABLE_DEV_TOOLS=true");
    return devProvider;
  }
  if (id === "stripe") return stripeProvider;
  throw new Error(`Unknown payment provider "${id}"`);
}
