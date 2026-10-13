import "server-only";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { db, schema } from "@/db";
import type { Purchase } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { expirePurchase, fulfillPurchase, setProviderRef } from "./purchases";

// Stripe Checkout (hosted payment page) for credit packs and hosting passes.
//
//   startStripeCheckout()  pending purchase → Checkout Session (price taken from our purchase row)
//   handleStripeEvent()    signed webhook → fulfil / cancel the purchase
//   syncCheckoutSession()  on return from Checkout → fulfil right away if the webhook is still on its way
//
// Fulfilment goes through fulfillPurchase(), which is idempotent, so the webhook and the return page
// may both run for the same payment. Before fulfilling, the session is checked against the purchase:
// same id, same amount, same currency – a session can never unlock a different or cheaper product.

export type StripeLike = {
  checkout: {
    sessions: {
      create: (params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => Promise<Stripe.Checkout.Session>;
      retrieve: (id: string) => Promise<Stripe.Checkout.Session>;
    };
  };
};

let client: Stripe | undefined;

/** Reads STRIPE_SECRET_KEY. The API version is the one pinned by the installed SDK. */
export function getStripe(): StripeLike {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  client ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: "AppBuilder" } });
  return client;
}

const CHECKOUT_LIFETIME_SECONDS = 60 * 60; // unpaid sessions expire after 1 hour (Stripe minimum: 30 min)

function platformUrl(path: string) {
  const base = process.env.BETTER_AUTH_URL;
  if (!base) throw new Error("BETTER_AUTH_URL is not set");
  return new URL(path, base).toString();
}

export async function startStripeCheckout(
  stripe: StripeLike,
  purchase: Purchase,
  ctx: { email: string; locale: Locale; productName: string },
): Promise<{ redirectUrl: string }> {
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: purchase.currency.toLowerCase(),
            unit_amount: purchase.amountCents,
            product_data: { name: ctx.productName },
          },
        },
      ],
      client_reference_id: purchase.id,
      metadata: { purchaseId: purchase.id, productId: purchase.productId },
      payment_intent_data: { metadata: { purchaseId: purchase.id } },
      customer_email: ctx.email,
      locale: ctx.locale,
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_LIFETIME_SECONDS,
      success_url: `${platformUrl("/dashboard/billing")}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${platformUrl("/dashboard/billing")}?checkout=cancelled`,
    },
    // A retried request for the same purchase returns the same session instead of creating a second one.
    { idempotencyKey: `checkout:${purchase.id}` },
  );
  if (!session.url) throw new Error("Stripe returned no checkout URL");
  await setProviderRef(purchase.id, session.id);
  return { redirectUrl: session.url };
}

export type SessionOutcome = "fulfilled" | "alreadyFulfilled" | "pending" | "unknownPurchase" | "mismatch" | "cancelled";

/** Fulfils the purchase behind a paid Checkout Session after checking that the session matches it. */
export async function fulfillCheckoutSession(session: Stripe.Checkout.Session, expectedUserId?: string): Promise<SessionOutcome> {
  if (session.payment_status !== "paid") return "pending"; // e.g. SEPA debit: async_payment_succeeded follows
  const purchaseId = session.client_reference_id ?? session.metadata?.purchaseId;
  if (!purchaseId) return "unknownPurchase";
  const [p] = await db.select().from(schema.purchases).where(eq(schema.purchases.id, purchaseId));
  if (!p || p.provider !== "stripe") return "unknownPurchase";
  if (expectedUserId && p.userId !== expectedUserId) return "unknownPurchase";
  if (
    session.mode !== "payment" ||
    session.amount_total !== p.amountCents ||
    session.currency?.toLowerCase() !== p.currency.toLowerCase() ||
    (p.providerRef && p.providerRef !== session.id)
  ) {
    console.error("[stripe] session does not match purchase", { sessionId: session.id, purchaseId });
    return "mismatch";
  }
  if (p.status === "cancelled") {
    // Paid after we had given up on it (should not happen: sessions expire before we cancel). Needs a refund.
    console.error("[stripe] payment for a cancelled purchase – refund manually", { sessionId: session.id, purchaseId });
    return "cancelled";
  }
  const { alreadyFulfilled } = await fulfillPurchase(p.id, session.id);
  return alreadyFulfilled ? "alreadyFulfilled" : "fulfilled";
}

export async function handleStripeEvent(event: Stripe.Event): Promise<SessionOutcome | "ignored" | "expired"> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return fulfillCheckoutSession(event.data.object);
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const purchaseId = event.data.object.client_reference_id ?? event.data.object.metadata?.purchaseId;
      if (purchaseId) await expirePurchase(purchaseId);
      return "expired";
    }
    default:
      return "ignored";
  }
}

/** Called on the success page: the customer may arrive before the webhook does. */
export async function syncCheckoutSession(stripe: StripeLike, sessionId: string, userId: string): Promise<SessionOutcome> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return "unknownPurchase";
  return fulfillCheckoutSession(await stripe.checkout.sessions.retrieve(sessionId), userId);
}

/** Verifies the Stripe-Signature header and parses the event. Throws on an invalid signature. */
export function verifyStripeWebhook(payload: string, signature: string, secret: string): Stripe.Event {
  return Stripe.webhooks.constructEvent(payload, signature, secret);
}
