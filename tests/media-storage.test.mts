// S3-compatible storage (against AWS's signing test vectors and a local fake S3 server) and the media cleanup.
// Run with `npm test` (uses TEST_DATABASE_URL and a temp media folder – no S3 account needed).
import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
process.env.DATABASE_URL = testUrl;
const mediaDir = await mkdtemp(path.join(tmpdir(), "appbuilder-media-"));
process.env.MEDIA_STORAGE = "local";
process.env.MEDIA_DIR = mediaDir;

const sharp = (await import("sharp")).default;
const { db, schema } = await import("@/db");
const { sql, eq } = await import("drizzle-orm");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const { signRequest, s3Storage, s3ConfigFromEnv } = await import("@/lib/media/s3");
const { saveImageUpload } = await import("@/lib/media/uploads");
const { getMediaStorage } = await import("@/lib/media/storage");
const { cleanupMedia, mediaIdsIn, UNUSED_MEDIA_GRACE_DAYS } = await import("@/lib/media/cleanup");
const { emptyLegal } = await import("@/lib/app-definition");

const DAY = 24 * 60 * 60 * 1000;
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

// ---------------------------------------------------------------------------
// Fake S3: stores objects in memory and recomputes the signature of every request
// ---------------------------------------------------------------------------

const CREDS = { accessKeyId: "TESTKEY", secretAccessKey: "test/secret+key", region: "eu-test-1" };

interface FakeObject {
  data: Buffer;
  contentType: string;
  lastModified: Date;
}

function startFakeS3() {
  const objects = new Map<string, FakeObject>(); // "bucket/key"
  const requests: string[] = [];
  let failNext = 0; // answer the next N requests with 500
  const PAGE = 2;

  const read = (req: IncomingMessage) =>
    new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });

  const signatureError = (req: IncomingMessage, body: Buffer) => {
    const auth = req.headers.authorization ?? "";
    const signed = /SignedHeaders=([^,]+)/.exec(auth)?.[1].split(";") ?? [];
    const payloadHash = String(req.headers["x-amz-content-sha256"]);
    if (payloadHash !== sha256(body)) return "payload hash mismatch";
    const amz = String(req.headers["x-amz-date"]);
    const date = new Date(`${amz.slice(0, 4)}-${amz.slice(4, 6)}-${amz.slice(6, 8)}T${amz.slice(9, 11)}:${amz.slice(11, 13)}:${amz.slice(13, 15)}Z`);
    const headers: Record<string, string> = {};
    for (const name of signed) {
      if (name === "host" || name.startsWith("x-amz-")) continue;
      headers[name] = String(req.headers[name]);
    }
    const expected = signRequest({ method: req.method!, url: new URL(`http://${req.headers.host}${req.url}`), headers, payloadHash, date, ...CREDS });
    return expected.Authorization === auth ? null : "signature mismatch";
  };

  const server = createServer(async (req, res) => {
    const body = await read(req);
    const url = new URL(`http://${req.headers.host}${req.url}`);
    requests.push(`${req.method} ${url.pathname}${url.search}`);
    if (failNext > 0) {
      failNext--;
      res.writeHead(500).end("<Error><Code>InternalError</Code></Error>");
      return;
    }
    const error = signatureError(req, body);
    if (error) {
      res.writeHead(403).end(`<Error><Code>SignatureDoesNotMatch</Code><Message>${error}</Message></Error>`);
      return;
    }
    const [, bucket, ...rest] = decodeURIComponent(url.pathname).split("/");
    const key = rest.join("/");
    const id = `${bucket}/${key}`;

    if (req.method === "GET" && !key && url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const start = Number((url.searchParams.get("continuation-token") ?? "t&0").split("&")[1]);
      const keys = [...objects.keys()].filter((k) => k.startsWith(`${bucket}/${prefix}`)).sort();
      const page = keys.slice(start, start + PAGE);
      const truncated = start + PAGE < keys.length;
      const contents = page
        .map((k) => `<Contents><Key>${k.slice(bucket.length + 1)}</Key><LastModified>${objects.get(k)!.lastModified.toISOString()}</LastModified></Contents>`)
        .join("");
      res.writeHead(200, { "content-type": "application/xml" }).end(
        `<?xml version="1.0"?><ListBucketResult><IsTruncated>${truncated}</IsTruncated>${contents}` +
          (truncated ? `<NextContinuationToken>t&amp;${start + PAGE}</NextContinuationToken>` : "") +
          `</ListBucketResult>`,
      );
    } else if (req.method === "PUT") {
      objects.set(id, { data: body, contentType: String(req.headers["content-type"]), lastModified: new Date() });
      res.writeHead(200).end();
    } else if (req.method === "GET") {
      const obj = objects.get(id);
      if (!obj) res.writeHead(404).end("<Error><Code>NoSuchKey</Code></Error>");
      else res.writeHead(200, { "content-type": obj.contentType }).end(obj.data);
    } else if (req.method === "DELETE") {
      objects.delete(id);
      res.writeHead(204).end();
    } else res.writeHead(405).end();
  });

  return new Promise<{ endpoint: string; objects: Map<string, FakeObject>; requests: string[]; failNext: (n: number) => void; close: () => Promise<void> }>(
    (resolve) =>
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resolve({
          endpoint: `http://127.0.0.1:${port}`,
          objects,
          requests,
          failNext: (n) => (failNext = n),
          close: () => new Promise((r) => server.close(() => r())),
        });
      }),
  );
}

let s3: Awaited<ReturnType<typeof startFakeS3>>;
const fakeStorage = (prefix = "", secretAccessKey = CREDS.secretAccessKey) =>
  s3Storage({ endpoint: s3.endpoint, bucket: "media-bucket", forcePathStyle: true, prefix, ...CREDS, secretAccessKey });

before(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  s3 = await startFakeS3();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE hosting_reminders, free_previews, media, ai_usage, credit_transactions, credit_holds, credit_lots, purchases, app_versions, submissions, apps, session, account, "user"`,
  );
  for (const f of await readdir(mediaDir)) await rm(path.join(mediaDir, f), { force: true });
  s3.objects.clear();
  s3.requests.length = 0;
});

after(async () => {
  await db.$client.end();
  await s3.close();
  await rm(mediaDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe("S3 request signing (AWS Signature V4)", () => {
  // Examples from the AWS documentation "Signature Calculations for the Authorization Header".
  const aws = {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    date: new Date("2013-05-24T00:00:00Z"),
  };
  const signatureOf = (headers: Record<string, string>) => /Signature=([0-9a-f]{64})$/.exec(headers.Authorization)?.[1];

  test("GET object", () => {
    const headers = signRequest({
      ...aws,
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { range: "bytes=0-9" },
      payloadHash: sha256(""),
    });
    assert.match(headers.Authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,/);
    assert.equal(signatureOf(headers), "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    assert.equal(headers["x-amz-date"], "20130524T000000Z");
  });

  test("PUT object", () => {
    const headers = signRequest({
      ...aws,
      method: "PUT",
      url: new URL("https://examplebucket.s3.amazonaws.com/test%24file.text"),
      headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
      payloadHash: sha256("Welcome to Amazon S3."),
    });
    assert.equal(signatureOf(headers), "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });

  test("list objects (sorted query string)", () => {
    const headers = signRequest({
      ...aws,
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/?prefix=J&max-keys=2"),
      headers: {},
      payloadHash: sha256(""),
    });
    assert.equal(signatureOf(headers), "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });
});

describe("S3 storage", () => {
  test("puts, gets, lists and deletes objects under the prefix", async () => {
    const storage = fakeStorage("tenant-a/");
    const data = new Uint8Array([1, 2, 3, 4]);
    for (const key of ["a1.webp", "a2.webp", "a3.webp", "a4.webp", "a5.webp"]) await storage.put(key, data, "image/webp");
    s3.objects.set("media-bucket/other/x.webp", { data: Buffer.from(data), contentType: "image/webp", lastModified: new Date() });

    const obj = s3.objects.get("media-bucket/tenant-a/a1.webp");
    assert.equal(obj?.contentType, "image/webp");
    assert.deepEqual(await storage.get("a1.webp"), data);
    assert.equal(await storage.get("missing.webp"), null);

    const listed: string[] = [];
    for await (const file of storage.list()) listed.push(file.key);
    assert.deepEqual(listed, ["a1.webp", "a2.webp", "a3.webp", "a4.webp", "a5.webp"]); // 3 pages, other prefix ignored
    assert.equal(s3.requests.filter((r) => r.includes("list-type=2")).length, 3);

    await storage.delete("a1.webp");
    await storage.delete("a1.webp"); // deleting twice is fine
    assert.equal(await storage.get("a1.webp"), null);
  });

  test("retries server errors and reports other failures", async () => {
    const storage = fakeStorage();
    s3.failNext(2);
    await storage.put("retry.webp", new Uint8Array([9]), "image/webp");
    assert.ok(s3.objects.has("media-bucket/retry.webp"));

    s3.failNext(3);
    await assert.rejects(storage.get("retry.webp"), /S3 GET retry\.webp failed: 500 InternalError/);

    const wrongKey = fakeStorage("", "wrong-secret");
    await assert.rejects(wrongKey.put("x.webp", new Uint8Array([1])), /403 SignatureDoesNotMatch/);
  });

  test("uses virtual-hosted URLs unless path style is forced", async () => {
    const urls: string[] = [];
    const fakeFetch = (async (url: URL) => {
      urls.push(String(url));
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;
    const config = { endpoint: "https://fsn1.your-objectstorage.com", bucket: "my-bucket", ...CREDS };
    await s3Storage({ ...config, prefix: "media/" }, fakeFetch).get("abc.webp");
    await s3Storage({ ...config, forcePathStyle: true }, fakeFetch).get("abc.webp");
    assert.deepEqual(urls, [
      "https://my-bucket.fsn1.your-objectstorage.com/media/abc.webp",
      "https://fsn1.your-objectstorage.com/my-bucket/abc.webp",
    ]);
  });

  test("configuration from the environment", () => {
    assert.throws(() => s3ConfigFromEnv({}), /S3_ENDPOINT is required/);
    const env = { S3_ENDPOINT: "https://s3.example", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" };
    assert.deepEqual(s3ConfigFromEnv(env), {
      endpoint: "https://s3.example",
      region: "us-east-1",
      bucket: "b",
      accessKeyId: "k",
      secretAccessKey: "s",
      forcePathStyle: false,
      prefix: "",
    });
    assert.throws(() => s3Storage({ ...s3ConfigFromEnv(env), prefix: "../" }), /Invalid S3 prefix/);
  });

  test("uploads work end to end with MEDIA_STORAGE=s3", async () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      MEDIA_STORAGE: "s3",
      S3_ENDPOINT: s3.endpoint,
      S3_BUCKET: "media-bucket",
      S3_REGION: CREDS.region,
      S3_ACCESS_KEY_ID: CREDS.accessKeyId,
      S3_SECRET_ACCESS_KEY: CREDS.secretAccessKey,
      S3_FORCE_PATH_STYLE: "true",
      S3_PREFIX: "uploads/",
    });
    try {
      const { userId, appId } = await createUserWithApp();
      const res = await saveImageUpload({ userId, appId, file: await jpegFile() });
      const key = `media-bucket/uploads/${res.id}.webp`;
      assert.equal(s3.objects.get(key)?.contentType, "image/webp");
      assert.ok(await getMediaStorage().get(`${res.id}.webp`));
      await assert.rejects(getMediaStorage().get("../secret"), /Invalid media key/);
      assert.deepEqual(await readdir(mediaDir), []); // nothing on the local disk
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

let seq = 0;
async function createUserWithApp(blocks: unknown[] = []) {
  const userId = `cu${++seq}_${Date.now()}`;
  await db.insert(schema.user).values({ id: userId, name: "Cleanup", email: `${userId}@example.test` });
  const appId = `ca${seq}_${Date.now()}`;
  await db.insert(schema.apps).values({
    id: appId,
    ownerId: userId,
    slug: appId.toLowerCase().replace(/_/g, "-"),
    name: "Cleanup App",
    definition: { version: 1, blocks } as never,
    legal: emptyLegal,
  });
  return { userId, appId };
}

const jpegFile = async () =>
  new File([new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).jpeg().toBuffer())], "p.jpg", { type: "image/jpeg" });

const imageBlock = (url: string) => ({ id: `b${++seq}`, type: "image", url, alt: "" });
const setApp = (appId: string, blocks: unknown[]) =>
  db.update(schema.apps).set({ definition: { version: 1, blocks } as never }).where(eq(schema.apps.id, appId));
const age = (mediaId: string, days: number) =>
  db.update(schema.media).set({ createdAt: new Date(Date.now() - days * DAY) }).where(eq(schema.media.id, mediaId));
const ageFile = (key: string, days: number) => {
  const t = new Date(Date.now() - days * DAY);
  return utimes(path.join(mediaDir, key), t, t);
};
const mediaIds = async () => (await db.select({ id: schema.media.id }).from(schema.media)).map((m) => m.id).sort();

describe("media cleanup", () => {
  test("finds media URLs in relative and absolute form", () => {
    const text = JSON.stringify([imageBlock("/media/abcdefghij12.webp"), { href: "https://x.example.de/media/ZYX_-0987654321.webp?v=1" }]);
    assert.deepEqual(mediaIdsIn(text), ["abcdefghij12", "ZYX_-0987654321"]);
    assert.deepEqual(mediaIdsIn('"/media/short.webp" "/mediathek/abcdefghij12.webp"'), []);
  });

  test("deletes old uploads no app or undo snapshot uses, and keeps everything else", async () => {
    const { userId, appId } = await createUserWithApp();
    const other = await createUserWithApp();
    const upload = async () => saveImageUpload({ userId, appId, file: await jpegFile() });
    const [used, inSnapshot, elsewhere, unused, fresh] = [await upload(), await upload(), await upload(), await upload(), await upload()];
    for (const m of [used, inSnapshot, elsewhere, unused]) await age(m.id, UNUSED_MEDIA_GRACE_DAYS + 1);

    await setApp(appId, [imageBlock(used.url)]);
    await db.insert(schema.appVersions).values({
      id: `v${++seq}`,
      appId,
      name: "Before",
      themeColor: "#000000",
      definition: { version: 1, blocks: [imageBlock(inSnapshot.url)] } as never,
      reason: "redesign",
    });
    await setApp(other.appId, [imageBlock(`https://shop.example.de${elsewhere.url}`)]);

    const result = await cleanupMedia();
    assert.deepEqual(result, { unusedDeleted: 1, orphanedFilesDeleted: 0, failed: 0 });
    assert.deepEqual(await mediaIds(), [used.id, inSnapshot.id, elsewhere.id, fresh.id].sort());
    assert.deepEqual((await readdir(mediaDir)).sort(), [used, inSnapshot, elsewhere, fresh].map((m) => `${m.id}.webp`).sort());
    assert.equal(await getMediaStorage().get(`${unused.id}.webp`), null);

    // Nothing left to do on a second run.
    assert.deepEqual(await cleanupMedia(), { unusedDeleted: 0, orphanedFilesDeleted: 0, failed: 0 });
  });

  test("deletes files without a database row once they are a day old", async () => {
    const { userId, appId } = await createUserWithApp();
    const kept = await saveImageUpload({ userId, appId, file: await jpegFile() });
    await setApp(appId, [imageBlock(kept.url)]);
    await ageFile(`${kept.id}.webp`, 3);
    await writeFile(path.join(mediaDir, "oldorphan123.webp"), new Uint8Array([1]));
    await ageFile("oldorphan123.webp", 2);
    await writeFile(path.join(mediaDir, "neworphan123.webp"), new Uint8Array([1])); // upload in progress
    await writeFile(path.join(mediaDir, ".gitkeep"), "");
    await ageFile(".gitkeep", 30);

    assert.deepEqual(await cleanupMedia(), { unusedDeleted: 0, orphanedFilesDeleted: 1, failed: 0 });
    assert.deepEqual((await readdir(mediaDir)).sort(), [".gitkeep", `${kept.id}.webp`, "neworphan123.webp"].sort());
  });

  test("removes the files of deleted apps and accounts", async () => {
    const { userId, appId } = await createUserWithApp();
    const image = await saveImageUpload({ userId, appId, file: await jpegFile() });
    await setApp(appId, [imageBlock(image.url)]);
    await db.delete(schema.user).where(eq(schema.user.id, userId)); // apps and media rows cascade

    assert.deepEqual(await cleanupMedia(), { unusedDeleted: 0, orphanedFilesDeleted: 0, failed: 0 }); // too fresh
    assert.deepEqual(await cleanupMedia(new Date(Date.now() + 2 * DAY)), { unusedDeleted: 0, orphanedFilesDeleted: 1, failed: 0 });
    assert.deepEqual(await readdir(mediaDir), []);
  });

  test("works the same with S3 storage", async () => {
    const storage = fakeStorage("media/");
    await storage.put("s3orphan1234.webp", new Uint8Array([1]), "image/webp");
    s3.objects.get("media-bucket/media/s3orphan1234.webp")!.lastModified = new Date(Date.now() - 2 * DAY);
    await storage.put("s3fresh12345.webp", new Uint8Array([1]), "image/webp");

    assert.deepEqual(await cleanupMedia(new Date(), storage), { unusedDeleted: 0, orphanedFilesDeleted: 1, failed: 0 });
    assert.deepEqual([...s3.objects.keys()], ["media-bucket/media/s3fresh12345.webp"]);
  });
});
