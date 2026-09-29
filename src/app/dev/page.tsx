import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { formatDateTime, formatEur, formatUsd } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { USD_TO_EUR } from "@/lib/billing/catalog";
import { checkLedgerInvariant, getBalance } from "@/lib/billing/ledger";
import { GrantForm } from "./grant-form";

export default async function DevToolsPage() {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const d = t.dev;

  const users = await db
    .select({ id: schema.user.id, email: schema.user.email, name: schema.user.name })
    .from(schema.user)
    .orderBy(schema.user.createdAt);
  const rows = await Promise.all(
    users.map(async (u) => ({ ...u, balance: await getBalance(u.id), ledger: await checkLedgerInvariant(u.id) })),
  );

  const u = schema.aiUsage;
  const economics = await db
    .select({
      action: u.action,
      count: sql<number>`count(*)::int`,
      credits: sql<number>`coalesce(sum(${u.creditsCharged}), 0)::int`,
      cost: sql<number>`coalesce(sum(${u.costMicroUsd}), 0)::bigint`,
    })
    .from(u)
    .groupBy(u.action)
    .orderBy(u.action);

  const purchases = await db
    .select({ p: schema.purchases, email: schema.user.email })
    .from(schema.purchases)
    .innerJoin(schema.user, eq(schema.user.id, schema.purchases.userId))
    .orderBy(desc(schema.purchases.createdAt))
    .limit(10);

  const card = "rounded-xl border bg-white p-5";
  const th = "py-2 text-left text-xs font-semibold uppercase text-zinc-500";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{d.title}</h1>
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <section className={card}>
          <h2 className="mb-3 font-semibold">{d.grantTitle}</h2>
          <GrantForm users={users.map(({ id, email }) => ({ id, email }))} />
        </section>

        <section className={card}>
          <h2 className="mb-3 font-semibold">{d.users}</h2>
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t first:border-t-0">
                  <td className="py-2">{r.email}</td>
                  <td className="py-2 text-right font-medium">{t.billing.credits(r.balance)}</td>
                  <td className={`py-2 text-right text-xs ${r.ledger.ok ? "text-green-700" : "font-bold text-red-600"}`}>
                    {r.ledger.ok ? `✓ ${d.ledgerOk}` : d.ledgerBroken}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className={card}>
        <h2 className="mb-3 font-semibold">{d.economics}</h2>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={th}>{d.action}</th>
              <th className={`${th} text-right`}>{d.count}</th>
              <th className={`${th} text-right`}>{d.revenue}</th>
              <th className={`${th} text-right`}>{d.aiCost}</th>
              <th className={`${th} text-right`}>{d.margin}</th>
            </tr>
          </thead>
          <tbody>
            {economics.map((e) => {
              const revenueEur = e.credits / 100; // 1 credit = 1 cent
              const costEur = (Number(e.cost) / 1_000_000) * USD_TO_EUR;
              const margin = revenueEur > 0 ? Math.round(((revenueEur - costEur) / revenueEur) * 100) : 0;
              return (
                <tr key={e.action} className="border-t">
                  <td className="py-2">{t.billing.actions[e.action] ?? e.action}</td>
                  <td className="py-2 text-right">{e.count}</td>
                  <td className="py-2 text-right">{formatEur(e.credits, locale)}</td>
                  <td className="py-2 text-right">{formatUsd(Number(e.cost), locale)}</td>
                  <td className="py-2 text-right font-medium">{margin} %</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className={card}>
        <h2 className="mb-3 font-semibold">{d.purchases}</h2>
        <table className="w-full text-sm">
          <tbody>
            {purchases.map(({ p, email }) => (
              <tr key={p.id} className="border-t first:border-t-0">
                <td className="py-2 text-zinc-500">{formatDateTime(p.createdAt, locale)}</td>
                <td className="py-2">{email}</td>
                <td className="py-2">{p.productId}</td>
                <td className="py-2 text-right">{formatEur(p.amountCents, locale)}</td>
                <td className="py-2 text-right">{d.status[p.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
