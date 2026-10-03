import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getMediaStorage } from "@/lib/media/storage";

// Serves uploaded images at /media/<id>.<ext> on the platform and on every customer subdomain
// (proxy.ts leaves /media alone). IDs are unguessable; files never change, so caching is "forever".
export async function GET(_req: Request, ctx: RouteContext<"/media/[file]">) {
  const { file } = await ctx.params;
  const match = /^([A-Za-z0-9_-]{10,40})\.([a-z0-9]+)$/.exec(file);
  if (!match) return new Response("Not found", { status: 404 });

  const [row] = await db.select().from(schema.media).where(eq(schema.media.id, match[1]));
  if (!row || row.storageKey !== file) return new Response("Not found", { status: 404 });
  const data = await getMediaStorage().get(row.storageKey);
  if (!data) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": row.contentType,
      "Content-Length": String(data.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'",
    },
  });
}
