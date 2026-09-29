import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { formatEur } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { getProduct } from "@/lib/billing/catalog";
import { cancelPaymentAction, simulatePaymentAction } from "../../actions";

/** Stand-in for the Stripe Checkout page. */
export default async function DevCheckoutPage({ params }: PageProps<"/dev/checkout/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const [row] = await db
    .select({ p: schema.purchases, appName: schema.apps.name })
    .from(schema.purchases)
    .leftJoin(schema.apps, eq(schema.apps.id, schema.purchases.appId))
    .where(and(eq(schema.purchases.id, id), eq(schema.purchases.userId, user.id)));
  if (!row) notFound();
  const { p, appName } = row;
  const product = getProduct(p.productId);
  const productLabel =
    product?.kind === "credits"
      ? t.billing.credits(product.credits)
      : product?.kind === "hosting"
        ? `${t.billing.hostingTitle} · ${t.billing.months(product.months)} ${t.billing.hostingFor} ${appName}`
        : p.productId;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <p className="mb-1 w-fit rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">TEST</p>
        <h1 className="text-xl font-bold">{t.dev.checkoutTitle}</h1>
        <p className="mt-1 text-sm text-zinc-600">{t.dev.checkoutIntro}</p>
        <dl className="mt-5 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-zinc-500">{t.dev.product}</dt>
            <dd className="font-medium">{productLabel}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">{t.dev.price}</dt>
            <dd className="text-lg font-bold">{formatEur(p.amountCents, locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">Status</dt>
            <dd>{t.dev.status[p.status]}</dd>
          </div>
        </dl>
        {p.status === "pending" && (
          <div className="mt-6 flex gap-2">
            <form action={simulatePaymentAction.bind(null, p.id)} className="flex-1">
              <button className="w-full rounded-lg bg-zinc-900 py-2.5 font-medium text-white">{t.dev.pay}</button>
            </form>
            <form action={cancelPaymentAction.bind(null, p.id)}>
              <button className="rounded-lg border px-4 py-2.5">{t.dev.cancel}</button>
            </form>
          </div>
        )}
      </div>
      <Link href="/dashboard/billing" className="block text-center text-sm text-zinc-500 underline">
        {t.dev.back}
      </Link>
    </div>
  );
}
