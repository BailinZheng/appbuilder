import { AppRenderer } from "@/components/AppRenderer";
import { getBase, getPublishedApp } from "./data";

export default async function TenantHome({ params }: PageProps<"/s/[slug]">) {
  const { slug } = await params;
  const app = (await getPublishedApp(slug))!; // layout already 404s when missing
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
