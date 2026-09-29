import Link from "next/link";
import { notFound } from "next/navigation";
import { SettingsMenu } from "@/components/SettingsMenu";
import { getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { devToolsEnabled } from "@/lib/dev-tools";

// Everything under /dev only exists when ENABLE_DEV_TOOLS=true – otherwise it is a 404.
export default async function DevLayout({ children }: LayoutProps<"/dev">) {
  if (!devToolsEnabled()) notFound();
  await requireUser();
  const t = await getT();
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="font-bold">AppBuilder</Link>
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{t.dev.title}</span>
          </div>
          <SettingsMenu />
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</div>
    </div>
  );
}
