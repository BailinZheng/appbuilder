import type { AppDefinition, Block } from "@/lib/app-definition";
import { ContactForm } from "./ContactForm";

type Props = {
  name: string;
  themeColor: string;
  definition: AppDefinition;
  /** Base path for links inside the app: "" on a subdomain, "/s/<slug>" otherwise. */
  base: string;
  slug: string;
  preview?: boolean;
};

/** Renders a customer app from its JSON definition. Used by the public site and the editor preview. */
export function AppRenderer({ name, themeColor, definition, base, slug, preview }: Props) {
  return (
    <div className="flex min-h-full flex-col bg-white text-zinc-900" style={{ ["--brand" as string]: themeColor }}>
      <header className="px-5 py-3 text-white" style={{ background: themeColor }}>
        <span className="font-semibold">{name}</span>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-8 px-5 py-8">
        {definition.blocks.map((b) => (
          <BlockView key={b.id} block={b} slug={slug} preview={preview} />
        ))}
      </main>
      <footer className="border-t px-5 py-4 text-center text-sm text-zinc-500">
        <a href={`${base}/impressum`} className="underline">Impressum</a>
        {" · "}
        <a href={`${base}/datenschutz`} className="underline">Datenschutz</a>
      </footer>
    </div>
  );
}

function BlockView({ block: b, slug, preview }: { block: Block; slug: string; preview?: boolean }) {
  switch (b.type) {
    case "hero":
      return (
        <section className="rounded-2xl px-6 py-10 text-center text-white" style={{ background: "var(--brand)" }}>
          <h1 className="text-3xl font-bold">{b.title}</h1>
          {b.subtitle && <p className="mt-2 opacity-90">{b.subtitle}</p>}
        </section>
      );
    case "text":
      return (
        <section>
          {b.heading && <h2 className="mb-2 text-xl font-semibold">{b.heading}</h2>}
          <p className="whitespace-pre-line leading-relaxed">{b.body}</p>
        </section>
      );
    case "image":
      return b.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={b.url} alt={b.alt} className="w-full rounded-xl" />
      ) : (
        <div className="flex h-40 items-center justify-center rounded-xl bg-zinc-100 text-zinc-400">Image</div>
      );
    case "button":
      return (
        <a
          href={b.href || "#"}
          className="block rounded-xl px-5 py-3 text-center font-medium text-white"
          style={{ background: "var(--brand)" }}
        >
          {b.label}
        </a>
      );
    case "hours":
      return (
        <section className="rounded-xl border p-5">
          <h2 className="mb-2 text-lg font-semibold">{b.title}</h2>
          <p className="whitespace-pre-line text-zinc-700">{b.lines}</p>
        </section>
      );
    case "contact":
      return <ContactForm slug={slug} title={b.title} submitLabel={b.submitLabel} preview={preview} />;
  }
}
