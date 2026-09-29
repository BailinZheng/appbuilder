import { getBase, getPublishedApp } from "../data";

// Per-app PWA manifest – this is what makes each customer app installable.
export async function GET(_req: Request, ctx: RouteContext<"/s/[slug]/manifest.webmanifest">) {
  const { slug } = await ctx.params;
  const app = await getPublishedApp(slug);
  if (!app) return new Response("Not found", { status: 404 });
  const base = await getBase(slug);
  const manifest = {
    id: `${base}/`,
    name: app.name,
    short_name: app.name.slice(0, 12),
    start_url: `${base}/`,
    scope: `${base}/`,
    display: "standalone",
    background_color: "#ffffff",
    theme_color: app.themeColor,
    icons: [192, 512].map((s) => ({
      src: `${base}/app-icon?size=${s}`,
      sizes: `${s}x${s}`,
      type: "image/png",
      purpose: "any maskable",
    })),
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
