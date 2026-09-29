import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { getBase, getPublishedApp } from "./data";
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
  if (!(await getPublishedApp(slug))) notFound();
  return (
    <>
      {children}
      <RegisterSW />
    </>
  );
}
