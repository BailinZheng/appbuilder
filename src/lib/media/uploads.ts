import "server-only";
import { and, count, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import { detectImageType, processImage } from "./images";
import { MAX_IMAGES_PER_APP, MAX_UPLOAD_BYTES, mediaPath } from "./limits";
import { getMediaStorage } from "./storage";

export type UploadErrorCode = "tooLarge" | "unsupportedType" | "tooManyImages" | "notFound" | "invalidImage";

export class UploadError extends Error {
  constructor(readonly code: UploadErrorCode) {
    super(code);
    this.name = "UploadError";
  }
}

/** Validates, processes and stores one image for an app the user owns. */
export async function saveImageUpload(input: { userId: string; appId: string; file: File }) {
  const { userId, appId, file } = input;
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError("tooLarge");

  const [app] = await db
    .select({ id: schema.apps.id })
    .from(schema.apps)
    .where(and(eq(schema.apps.id, appId), eq(schema.apps.ownerId, userId)));
  if (!app) throw new UploadError("notFound");

  const [{ n }] = await db.select({ n: count() }).from(schema.media).where(eq(schema.media.appId, appId));
  if (n >= MAX_IMAGES_PER_APP) throw new UploadError("tooManyImages");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!detectImageType(bytes)) throw new UploadError("unsupportedType");

  let processed: Awaited<ReturnType<typeof processImage>>;
  try {
    processed = await processImage(bytes);
  } catch {
    throw new UploadError("invalidImage"); // corrupt file or a format sharp cannot decode
  }

  const id = nanoid(24);
  const storageKey = `${id}.${processed.extension}`;
  await getMediaStorage().put(storageKey, processed.data);
  try {
    await db.insert(schema.media).values({
      id,
      ownerId: userId,
      appId,
      storageKey,
      contentType: processed.contentType,
      bytes: processed.data.byteLength,
      width: processed.width,
      height: processed.height,
      originalName: file.name.slice(0, 200) || "image",
    });
  } catch (e) {
    await getMediaStorage().delete(storageKey); // keep disk and database in sync
    throw e;
  }
  return { id, url: mediaPath(id, processed.extension), width: processed.width, height: processed.height };
}
