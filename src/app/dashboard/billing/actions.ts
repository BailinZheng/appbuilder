"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getPaymentProvider } from "@/lib/billing/payment-provider";
import { createPurchase } from "@/lib/billing/purchases";

/** Starts a checkout for a credit pack or hosting pass and redirects to the payment page. */
export async function startCheckoutAction(formData: FormData) {
  const user = await requireUser();
  const productId = String(formData.get("productId") ?? "");
  const appId = formData.get("appId") ? String(formData.get("appId")) : null;
  let redirectUrl: string;
  try {
    const provider = getPaymentProvider();
    const purchase = await createPurchase({ userId: user.id, productId, appId, provider: provider.id });
    ({ redirectUrl } = await provider.startCheckout(purchase));
  } catch (e) {
    console.error("[billing] checkout failed", e);
    redirect("/dashboard/billing?error=checkout");
  }
  redirect(redirectUrl);
}
