import { AppRenderer } from "@/components/AppRenderer";
import { getBase, getPublishedApp } from "./data";

export default async function TenantHome({ params }: PageProps<"/s/[slug]">) {
  const { slug } = await params;
  // Pages render in parallel with the layout, which shows the 404 / offline notice – just render nothing.
  const app = await getPublishedApp(slug);
  if (!app) return null;
  return (
    <AppRenderer
      name={app.name}
      themeColor={app.themeColor}
      definition={app.definition}
      base={await getBase(slug)}
      slug={slug}
    />
  );
}
