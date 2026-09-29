import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-lg font-bold">AppBuilder</span>
        <nav className="flex gap-4 text-sm">
          <Link href="/sign-in">Sign in</Link>
          <Link href="/sign-up" className="rounded-lg bg-zinc-900 px-3 py-1.5 text-white">
            Get started
          </Link>
        </nav>
      </header>
      <main className="mx-auto flex max-w-3xl flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Your business app. No code.</h1>
        <p className="mt-4 text-lg text-zinc-600">
          For self-employed people and small businesses: build an installable app for your customers in
          minutes – hosted in Germany, GDPR-friendly.
        </p>
        <Link href="/sign-up" className="mt-8 rounded-xl bg-zinc-900 px-6 py-3 font-medium text-white">
          Create your app
        </Link>
      </main>
      <footer className="py-6 text-center text-sm text-zinc-500">
        <Link href="/impressum" className="underline">Impressum</Link> ·{" "}
        <Link href="/datenschutz" className="underline">Datenschutz</Link>
      </footer>
    </div>
  );
}
