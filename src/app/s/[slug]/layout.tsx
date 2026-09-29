import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { getBase, getPublishedApp, getPublishedAppAnyHosting } from "./data";
import { RegisterSW } from "./register-sw";

export async function generateMetadata({ params }: LayoutProps<"/s/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const app = await getPublishedApp(slug);
  if (!app) return {};
  const base = await getBase(slug);
  return {
    title: app.name,
    manifest: `${base}/manifest.webmanifest`,
    icons: { icon: `${base}/app-icon?size=192`, apple: `${base}/app-icon?size=180` },
    appleWebApp: { capable: true, title: app.name, statusBarStyle: "default" },
  };
}

export async function generateViewport({ params }: LayoutProps<"/s/[slug]">): Promise<Viewport> {
  const { slug } = await params;
  const app = await getPublishedApp(slug);
  return { themeColor: app?.themeColor ?? "#ffffff" };
}

export default async function TenantLayout({ children, params }: LayoutProps<"/s/[slug]">) {
  const { slug } = await params;
  if (!(await getPublishedApp(slug))) {
    // Hosting ran out: show a neutral notice instead of a 404. Nothing is deleted.
    const lapsed = await getPublishedAppAnyHosting(slug);
    if (!lapsed) notFound();
    return (
      <main className="flex flex-1 items-center justify-center px-6 text-center">
        <div>
          <h1 className="text-xl font-semibold">{lapsed.name}</h1>
          <p className="mt-2 text-zinc-500">
            Diese Seite ist vorübergehend nicht erreichbar.
            <br />
            This site is temporarily unavailable.
          </p>
        </div>
      </main>
    );
  }
  return (
    <>
      {children}
      <RegisterSW />
    </>
  );
}
