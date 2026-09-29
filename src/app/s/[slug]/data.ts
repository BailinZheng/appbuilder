import "server-only";
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "@/db";

export const getPublishedApp = cache(async (slug: string) => {
  const [app] = await db
    .select()
    .from(schema.apps)
    .where(and(eq(schema.apps.slug, slug), eq(schema.apps.published, true)));
  return app ?? null;
});

/** "" when served on <slug>.domain (set by proxy.ts), otherwise "/s/<slug>". */
export async function getBase(slug: string) {
  return (await headers()).get("x-app-base") === "" ? "" : `/s/${slug}`;
}
