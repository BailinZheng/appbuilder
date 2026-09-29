import Link from "next/link";
import { SettingsMenu } from "@/components/SettingsMenu";
import { getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { signOut } from "./actions";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const user = await requireUser();
  const t = await getT();
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/dashboard" className="font-bold">AppBuilder</Link>
          <div className="flex items-center gap-4 text-sm text-zinc-600">
            <span className="hidden sm:inline">{user.email}</span>
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
