import Link from "next/link";
import { SettingsMenu } from "@/components/SettingsMenu";
import { getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { getBalance } from "@/lib/billing/ledger";
import { devToolsEnabled } from "@/lib/dev-tools";
import { signOut } from "./actions";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const user = await requireUser();
  const [t, balance] = await Promise.all([getT(), getBalance(user.id)]);
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/dashboard" className="font-bold">AppBuilder</Link>
          <div className="flex items-center gap-4 text-sm text-zinc-600">
            {devToolsEnabled() && (
              <Link href="/dev" className="text-amber-700 underline">{t.dev.link}</Link>
            )}
            <Link
              href="/dashboard/billing"
              title={t.billing.nav}
              className="rounded-lg border px-2.5 py-1.5 font-medium text-zinc-800 hover:bg-zinc-50"
              data-testid="header-balance"
            >
              ◈ {t.billing.credits(balance)}
            </Link>
            <span className="hidden md:inline">{user.email}</span>
            <form action={signOut}>
              <button className="underline">{t.common.signOut}</button>
            </form>
            <SettingsMenu />
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</div>
    </div>
  );
}
