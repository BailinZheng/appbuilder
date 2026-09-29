import Link from "next/link";
import { SettingsMenu } from "@/components/SettingsMenu";
import { getT } from "@/i18n/server";

export default async function Home() {
  const t = await getT();
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-lg font-bold">AppBuilder</span>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/sign-in">{t.common.signIn}</Link>
          <Link href="/sign-up" className="rounded-lg bg-zinc-900 px-3 py-1.5 text-white">
            {t.home.getStarted}
          </Link>
          <SettingsMenu />
        </nav>
      </header>
      <main className="mx-auto flex max-w-3xl flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t.home.title}</h1>
        <p className="mt-4 text-lg text-zinc-600">{t.home.subtitle}</p>
        <Link href="/sign-up" className="mt-8 rounded-xl bg-zinc-900 px-6 py-3 font-medium text-white">
          {t.home.cta}
        </Link>
      </main>
      <footer className="py-6 text-center text-sm text-zinc-500">
        <Link href="/impressum" className="underline">{t.common.impressum}</Link> ·{" "}
        <Link href="/datenschutz" className="underline">{t.common.privacy}</Link>
      </footer>
    </div>
  );
}
