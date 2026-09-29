import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatDateTime, formatEur } from "@/i18n/format";
import { requireUser } from "@/lib/auth";
import { ACTION_PRICES, CREDIT_PACKS, HOSTING_PASSES, METERED_INSTRUCTION } from "@/lib/billing/catalog";
import { hostingStatus } from "@/lib/billing/hosting";
import { getActiveLots, getBalance, getHistory, sweepExpired } from "@/lib/billing/ledger";
import { startCheckoutAction } from "./actions";

export default async function BillingPage({ searchParams }: PageProps<"/dashboard/billing">) {
  const user = await requireUser();
  const [t, locale, { error, app: preselectedApp }] = await Promise.all([getT(), getLocale(), searchParams]);
  await sweepExpired(user.id);
  const [balance, lots, history, apps] = await Promise.all([
    getBalance(user.id),
    getActiveLots(user.id),
    getHistory(user.id, 30),
    db
      .select({ id: schema.apps.id, name: schema.apps.name, hostedUntil: schema.apps.hostedUntil })
      .from(schema.apps)
      .where(eq(schema.apps.ownerId, user.id))
      .orderBy(desc(schema.apps.createdAt)),
  ]);
  const b = t.billing;
  const priceRows: [string, string][] = [
    [b.actions.generate_site, t.ai.credits(ACTION_PRICES.generate_site)],
    [b.actions.redesign, t.ai.credits(ACTION_PRICES.redesign)],
    [b.actions.add_section, t.ai.credits(ACTION_PRICES.add_section)],
    [b.actions.rewrite, t.ai.credits(ACTION_PRICES.rewrite)],
    [b.actions.instruction, `${METERED_INSTRUCTION.min}–${METERED_INSTRUCTION.max}`],
  ];
  const card = "rounded-xl border bg-white p-5";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-bold">{b.title}</h1>
        <div className="rounded-xl border bg-white px-5 py-3 text-right">
          <p className="text-xs uppercase text-zinc-500">{b.balance}</p>
          <p className="text-2xl font-bold" data-testid="balance">{b.credits(balance)}</p>
        </div>
      </div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{b.purchaseError}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* Credit packs */}
          <section className={card}>
            <h2 className="font-semibold">{b.buyCredits}</h2>
            <p className="mb-4 text-sm text-zinc-500">{b.validity}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {CREDIT_PACKS.map((p) => (
                <form key={p.id} action={startCheckoutAction} className="flex flex-col rounded-xl border p-4">
                  <input type="hidden" name="productId" value={p.id} />
                  <p className="text-lg font-bold">{b.credits(p.credits)}</p>
                  <p className="text-sm text-zinc-600">{formatEur(p.priceCents, locale)}</p>
                  {p.bonusPercent > 0 && (
                    <span className="mt-1 w-fit rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">
                      {b.bonus(p.bonusPercent)}
                    </span>
                  )}
                  <button className="mt-3 rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white">{b.buy}</button>
                </form>
              ))}
            </div>
          </section>

          {/* Hosting */}
          <section className={card}>
            <h2 className="font-semibold">{b.hostingTitle}</h2>
            <p className="mb-4 text-sm text-zinc-500">{b.hostingIntro}</p>
            {apps.length === 0 && <p className="text-sm text-zinc-500">{b.noApps}</p>}
            <ul className="space-y-3">
              {apps.map((a) => {
                const s = hostingStatus(a.hostedUntil);
                const label =
                  s.state === "none"
                    ? b.hosting.none
                    : s.state === "active"
                      ? b.hosting.active(formatDate(s.until, locale))
                      : s.state === "grace"
                        ? b.hosting.grace(formatDate(s.offlineAt, locale))
                        : b.hosting.lapsed(formatDate(s.until, locale));
                return (
                  <li
                    key={a.id}
                    id={`hosting-${a.id}`}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${preselectedApp === a.id ? "ring-2 ring-zinc-900" : ""}`}
                  >
                    <div>
                      <p className="font-medium">{a.name}</p>
                      <p className={`text-sm ${s.state === "active" ? "text-green-700" : "text-amber-700"}`}>{label}</p>
                    </div>
                    <div className="flex gap-2">
                      {HOSTING_PASSES.map((h) => (
                        <form key={h.id} action={startCheckoutAction}>
                          <input type="hidden" name="productId" value={h.id} />
                          <input type="hidden" name="appId" value={a.id} />
                          <button className="rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-50">
                            {b.months(h.months)} · {formatEur(h.priceCents, locale)}
                          </button>
                        </form>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* History */}
          <section className={card}>
            <h2 className="mb-3 font-semibold">{b.history}</h2>
            {history.length === 0 && <p className="text-sm text-zinc-500">{b.historyEmpty}</p>}
            <table className="w-full text-sm">
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t">
                    <td className="py-2 text-zinc-500">{formatDateTime(h.createdAt, locale)}</td>
                    <td className="py-2">
                      {h.kind === "grant" ? b.sources[h.action ?? ""] ?? h.action : b.actions[h.action ?? ""] ?? h.action}
                    </td>
                    <td className={`py-2 text-right font-medium ${h.delta > 0 ? "text-green-700" : "text-zinc-900"}`}>
                      {h.delta > 0 ? "+" : ""}
                      {h.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <aside className="space-y-6">
          <section className={card}>
            <h2 className="mb-3 font-semibold">{b.priceList}</h2>
            <table className="w-full text-sm">
              <tbody>
                {priceRows.map(([label, price]) => (
                  <tr key={label} className="border-t first:border-t-0">
                    <td className="py-1.5">{label}</td>
                    <td className="py-1.5 text-right font-medium">{price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-zinc-500">{b.freeActions}</p>
          </section>
          <section className={card}>
            <h2 className="mb-3 font-semibold">{b.yourCredits}</h2>
            {lots.length === 0 && <p className="text-sm text-zinc-500">{b.noLots}</p>}
            <ul className="space-y-2 text-sm">
              {lots.map((l) => (
                <li key={l.id} className="flex justify-between gap-2">
                  <span>
                    {b.credits(l.remaining)} <span className="text-zinc-500">· {b.sources[l.source]}</span>
                  </span>
                  <span className="text-zinc-500">
                    {l.expiresAt ? `${b.expires} ${formatDate(l.expiresAt, locale)}` : b.never}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
