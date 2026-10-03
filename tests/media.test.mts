// Image upload & reference-URL tests. Run with `npm test` (uses TEST_DATABASE_URL and a temp media folder).
import "dotenv/config";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
process.env.DATABASE_URL = testUrl;
const mediaDir = await mkdtemp(path.join(tmpdir(), "appbuilder-media-"));
process.env.MEDIA_DIR = mediaDir;
process.env.MOCK_AI_LATENCY_MS = "0";

const sharp = (await import("sharp")).default;
const { db, schema } = await import("@/db");
const { sql, eq } = await import("drizzle-orm");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const { detectImageType, processImage } = await import("@/lib/media/images");
const { saveImageUpload, UploadError } = await import("@/lib/media/uploads");
const { getMediaStorage } = await import("@/lib/media/storage");
const { MAX_IMAGE_DIMENSION, MAX_UPLOAD_BYTES } = await import("@/lib/media/limits");
const { normalizeReferenceUrl } = await import("@/lib/ai/reference-url");
const { siteBriefSchema } = await import("@/lib/ai/types");
const { mockProvider } = await import("@/lib/ai/mock-provider");
const { emptyLegal } = await import("@/lib/app-definition");

let seq = 0;
async function createUserWithApp() {
  const userId = `mu${++seq}_${Date.now()}`;
  await db.insert(schema.user).values({ id: userId, name: "Media", email: `${userId}@example.test` });
  const appId = `ma${seq}_${Date.now()}`;
  await db.insert(schema.apps).values({
    id: appId,
    ownerId: userId,
    slug: appId.toLowerCase().replace(/_/g, "-"),
    name: "Media App",
    definition: { version: 1, blocks: [] },
    legal: emptyLegal,
  });
  return { userId, appId };
}

const jpeg = (width = 40, height = 30, exif?: Record<string, Record<string, string>>) => {
  let img = sharp({ create: { width, height, channels: 3, background: "#cc3366" } }).jpeg();
  if (exif) img = img.withExif(exif);
  return img.toBuffer();
};
const asFile = (data: Uint8Array, name = "photo.jpg", type = "image/jpeg") => new File([new Uint8Array(data)], name, { type });

before(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE media, ai_usage, credit_transactions, credit_holds, credit_lots, purchases, app_versions, submissions, apps, session, account, "user"`,
  );
  for (const f of await readdir(mediaDir)) await rm(path.join(mediaDir, f), { force: true });
});

after(async () => {
  await db.$client.end();
  await rm(mediaDir, { recursive: true, force: true });
});

describe("image validation & processing", () => {
  test("detects real image types from the file content, not the name", async () => {
    assert.equal(detectImageType(await jpeg()), "jpeg");
    assert.equal(detectImageType(await sharp({ create: { width: 2, height: 2, channels: 4, background: "#fff" } }).png().toBuffer()), "png");
    assert.equal(detectImageType(await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).webp().toBuffer()), "webp");
    assert.equal(detectImageType(await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).gif().toBuffer()), "gif");
    assert.equal(detectImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
    assert.equal(detectImageType(new TextEncoder().encode("%PDF-1.7")), null);
  });

  test("strips metadata (EXIF/GPS) and scales large images down", async () => {
    const input = await jpeg(3000, 1500, { IFD0: { Copyright: "SECRET-LOCATION", Artist: "Phone" } });
    assert.ok((await sharp(input).metadata()).exif, "fixture should carry EXIF");
    const out = await processImage(input);
    const meta = await sharp(out.data).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.exif, undefined);
    assert.ok(!Buffer.from(out.data).includes("SECRET-LOCATION"));
    assert.equal(out.width, MAX_IMAGE_DIMENSION);
    assert.equal(out.height, MAX_IMAGE_DIMENSION / 2);
  });

  test("never enlarges small images", async () => {
    const out = await processImage(await jpeg(40, 30));
    assert.deepEqual([out.width, out.height], [40, 30]);
  });
});

describe("uploads", () => {
  test("stores a processed image and serves it under an unguessable key", async () => {
    const { userId, appId } = await createUserWithApp();
    const res = await saveImageUpload({ userId, appId, file: asFile(await jpeg()) });
    assert.match(res.url, /^\/media\/[A-Za-z0-9_-]{24}\.webp$/);
    const [row] = await db.select().from(schema.media).where(eq(schema.media.id, res.id));
    assert.equal(row.contentType, "image/webp");
    assert.equal(row.originalName, "photo.jpg");
    const stored = await getMediaStorage().get(row.storageKey);
    assert.equal(detectImageType(stored!), "webp");
  });

  test("rejects other users' apps, fake images and oversized files", async () => {
    const owner = await createUserWithApp();
    const other = await createUserWithApp();
    const isCode = (code: string) => (e: unknown) => e instanceof UploadError && e.code === code;

    await assert.rejects(saveImageUpload({ userId: other.userId, appId: owner.appId, file: asFile(await jpeg()) }), isCode("notFound"));
    const svg = asFile(new TextEncoder().encode("<svg/>"), "evil.jpg", "image/jpeg"); // lies about its type
    await assert.rejects(saveImageUpload({ userId: owner.userId, appId: owner.appId, file: svg }), isCode("unsupportedType"));
    const big = asFile(new Uint8Array(MAX_UPLOAD_BYTES + 1));
    await assert.rejects(saveImageUpload({ userId: owner.userId, appId: owner.appId, file: big }), isCode("tooLarge"));
    const broken = asFile(new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]));
    await assert.rejects(saveImageUpload({ userId: owner.userId, appId: owner.appId, file: broken }), isCode("invalidImage"));

    assert.equal((await db.select().from(schema.media)).length, 0);
    assert.deepEqual(await readdir(mediaDir).catch(() => []), []);
  });

  test("storage refuses keys that could escape the media folder", async () => {
    const storage = getMediaStorage();
    await assert.rejects(storage.get("../.env"), /Invalid media key/);
    await assert.rejects(storage.put("..\\x.webp", new Uint8Array([1])), /Invalid media key/);
  });
});

describe("reference URLs", () => {
  test("normalises what people type and rejects non-public addresses", () => {
    assert.equal(normalizeReferenceUrl("meinbaecker.de"), "https://meinbaecker.de/");
    assert.equal(normalizeReferenceUrl("  https://www.example.com/about#team "), "https://www.example.com/about");
    assert.equal(normalizeReferenceUrl("http://example.org"), "http://example.org/");
    for (const bad of ["", "localhost:3000", "http://127.0.0.1", "http://[::1]/", "ftp://example.com", "javascript:alert(1)", "https://user:pw@example.com", "intranet", "http://printer.local", "not a url"]) {
      assert.equal(normalizeReferenceUrl(bad), null, bad);
    }
  });

  test("the brief accepts empty or valid URLs and reports which one is invalid", () => {
    const base = { businessName: "Test", industry: "bakery", city: "", services: "", tone: "friendly", phone: "" };
    const ok = siteBriefSchema.parse({ ...base, existingSiteUrl: "alt-baeckerei.de", inspirationUrl: "" });
    assert.equal(ok.existingSiteUrl, "https://alt-baeckerei.de/");
    assert.equal(ok.inspirationUrl, "");
    assert.equal(siteBriefSchema.parse(base).inspirationUrl, "");
    const bad = siteBriefSchema.safeParse({ ...base, inspirationUrl: "http://localhost" });
    assert.ok(!bad.success);
    assert.deepEqual(bad.error.issues.map((i) => i.path[0]), ["inspirationUrl"]);
  });

  test("the mock AI takes its colour from the inspiration site", async () => {
    const brief = siteBriefSchema.parse({ businessName: "Test", industry: "bakery", city: "", services: "", tone: "friendly", phone: "" });
    const plain = await mockProvider.generateSite(brief, "de");
    const inspired = await mockProvider.generateSite({ ...brief, inspirationUrl: "https://www.youtube.com/" }, "de");
    assert.notEqual(inspired.output.themeColor, plain.output.themeColor);
    assert.match(inspired.output.themeColor, /^#[0-9a-f]{6}$/);
  });
});
