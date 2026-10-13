import { handleStripeEvent, verifyStripeWebhook } from "@/lib/billing/stripe";

// Stripe webhook endpoint. Register https://<platform>/api/stripe/webhook in the Stripe dashboard for:
//   checkout.session.completed, checkout.session.async_payment_succeeded,
//   checkout.session.async_payment_failed, checkout.session.expired
//
// Only requests with a valid Stripe-Signature are processed. A non-2xx answer makes Stripe retry
// (for up to 3 days), so 500 is returned only for errors a retry can fix (e.g. the database was down).

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe] STRIPE_WEBHOOK_SECRET is not set");
    return new Response("Webhook not configured", { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const payload = await request.text(); // the exact raw body is needed for the signature check
  let event;
  try {
    event = verifyStripeWebhook(payload, signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event);
    if (result === "unknownPurchase" || result === "mismatch" || result === "cancelled") {
      console.error(`[stripe] ${event.type} ${event.id}: ${result}`); // retrying would not help
    }
    return Response.json({ received: true, result });
  } catch (e) {
    console.error(`[stripe] ${event.type} ${event.id} failed`, e);
    return new Response("Processing failed", { status: 500 });
  }
}
