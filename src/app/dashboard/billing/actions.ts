"use server";

import { redirect } from "next/navigation";
import { getLocale, getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { getProduct } from "@/lib/billing/catalog";
import { getPaymentProvider } from "@/lib/billing/payment-provider";
import { createPurchase } from "@/lib/billing/purchases";

/** Starts a checkout for a credit pack or hosting pass and redirects to the payment page. */
export async function startCheckoutAction(formData: FormData) {
  const user = await requireUser();
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const productId = String(formData.get("productId") ?? "");
  const appId = formData.get("appId") ? String(formData.get("appId")) : null;
  let redirectUrl: string;
  try {
    const provider = getPaymentProvider();
    const purchase = await createPurchase({ userId: user.id, productId, appId, provider: provider.id });
    const product = getProduct(purchase.productId)!;
    const productName =
      product.kind === "credits"
        ? `AppBuilder · ${t.billing.credits(product.credits)}`
        : `AppBuilder · ${t.billing.hostingTitle} · ${t.billing.months(product.months)}`;
    ({ redirectUrl } = await provider.startCheckout(purchase, { email: user.email, locale, productName }));
  } catch (e) {
    console.error("[billing] checkout failed", e);
    redirect("/dashboard/billing?error=checkout");
  }
  redirect(redirectUrl);
}
