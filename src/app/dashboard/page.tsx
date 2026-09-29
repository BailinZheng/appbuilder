import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { formatDate } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { hostingStatus } from "@/lib/billing/hosting";
import { getBalance } from "@/lib/billing/ledger";
import { appUrl } from "@/lib/urls";
import { CreateAppForm } from "./create-app-form";
import { GenerateForm } from "./generate-form";

export default async function Dashboard() {
  const user = await requireUser();
  const [t, locale, balance] = await Promise.all([getT(), getLocale(), getBalance(user.id)]);
  const apps = await db
    .select()
    .from(schema.apps)
    .where(eq(schema.apps.ownerId, user.id))
    .orderBy(desc(schema.apps.createdAt));

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_360px]">
      <section>
        <h1 className="mb-4 text-2xl font-bold">{t.dashboard.yourApps}</h1>
        {apps.length === 0 && <p className="text-zinc-500">{t.dashboard.noApps}</p>}
        <ul className="space-y-3">
          {apps.map((a) => {
            const h = hostingStatus(a.hostedUntil);
            return (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl border bg-white p-4">
                <div className="flex items-center gap-3">
                  <span className="h-8 w-8 shrink-0 rounded-lg" style={{ background: a.themeColor }} />
                  <div>
                    <p className="font-medium">{a.name}</p>
                    <p className="text-sm text-zinc-500">
                      {a.published ? (
                        <a href={appUrl(a.slug)} target="_blank" className="underline">{appUrl(a.slug)}</a>
                      ) : (
                        t.dashboard.draft
                      )}
                    </p>
                    <p className={`text-xs ${h.state === "active" ? "text-green-700" : "text-zinc-500"}`}>
                      {h.state === "none"
                        ? t.billing.hosting.none
                        : h.state === "active"
                          ? t.billing.hosting.active(formatDate(h.until, locale))
                          : h.state === "grace"
                            ? t.billing.hosting.grace(formatDate(h.offlineAt, locale))
                            : t.billing.hosting.lapsed(formatDate(h.until, locale))}
                    </p>
                  </div>
                </div>
                <Link href={`/dashboard/apps/${a.id}`} className="rounded-lg border px-3 py-1.5 text-sm">
                  {t.dashboard.edit}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
      <aside className="space-y-6">
        <div className="rounded-xl border border-violet-200 bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-semibold">✨ {t.ai.generateTitle}</h2>
          <GenerateForm balance={balance} />
        </div>
        <div className="rounded-xl border bg-white p-5">
          <h2 className="mb-3 font-semibold">{t.dashboard.newApp}</h2>
          <CreateAppForm />
        </div>
      </aside>
    </div>
  );
}
