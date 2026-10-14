import "server-only";
import { createHash, createHmac } from "node:crypto";
import type { MediaStorage, StoredObject } from "./storage";

/**
 * Minimal S3 client for the media storage: PUT, GET, DELETE and ListObjectsV2, signed with AWS Signature V4.
 * Works with any S3-compatible service (Hetzner Object Storage, AWS S3, Cloudflare R2, MinIO, …).
 * No SDK: four requests do not justify a large dependency, and the signing is covered by AWS's test vectors.
 *
 * The bucket stays private – images are served through /media/<id>.<ext>, which checks the database row.
 */

export interface S3Config {
  endpoint: string; // e.g. https://fsn1.your-objectstorage.com
  region: string; // e.g. fsn1, eu-central-1, auto (R2)
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean; // https://endpoint/bucket/key instead of https://bucket.endpoint/key (MinIO)
  prefix?: string; // key prefix inside the bucket, e.g. "media/"
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as required by SigV4 (encodeURIComponent leaves !'()* alone). */
const encode = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface SignInput {
  method: string;
  url: URL;
  headers: Record<string, string>; // without host/x-amz-*; all of them are signed
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  date: Date;
}

/** Returns the headers to send: the given ones plus x-amz-date, x-amz-content-sha256 and Authorization. */
export function signRequest(input: SignInput): Record<string, string> {
  const amzDate = input.date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); // 20130524T000000Z
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...input.headers,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": amzDate,
  };
  const toSign: Record<string, string> = { host: input.url.host };
  for (const [k, v] of Object.entries(headers)) toSign[k.toLowerCase()] = v.trim().replace(/\s+/g, " ");
  const names = Object.keys(toSign).sort();
  const signedHeaders = names.join(";");

  const query = [...input.url.searchParams]
    .map(([k, v]) => [encode(k), encode(v)])
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [
    input.method,
    input.url.pathname, // already encoded by buildUrl()
    query,
    names.map((n) => `${n}:${toSign[n]}\n`).join(""),
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${day}/${input.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");

  headers.Authorization =
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

const decodeXml = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e: string) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[e]!);
const xmlTag = (xml: string, tag: string) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? decodeXml(m[1]) : undefined;
};

const RETRIES = 2;
const TIMEOUT_MS = 30_000;

export function s3Storage(config: S3Config, fetchImpl: typeof fetch = fetch): MediaStorage {
  const endpoint = new URL(config.endpoint);
  const prefix = config.prefix ?? "";
  if (!/^([A-Za-z0-9_-]+\/)*$/.test(prefix)) throw new Error(`Invalid S3 prefix: ${prefix} (e.g. "media/")`);

  const buildUrl = (key: string, query: Record<string, string> = {}) => {
    const objectPath = key ? `/${(prefix + key).split("/").map(encode).join("/")}` : "/";
    const url = new URL(endpoint.origin);
    if (config.forcePathStyle) url.pathname = `/${encode(config.bucket)}${objectPath}`;
    else {
      url.host = `${config.bucket}.${endpoint.host}`;
      url.pathname = objectPath;
    }
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return url;
  };

  async function send(method: string, url: URL, body?: Uint8Array, headers: Record<string, string> = {}) {
    for (let attempt = 0; ; attempt++) {
      const signed = signRequest({
        method,
        url,
        headers,
        payloadHash: sha256(body ?? ""),
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        region: config.region,
        date: new Date(), // re-signed per attempt: signatures are only valid for 15 minutes
      });
      try {
        const res = await fetchImpl(url, {
          method,
          headers: signed,
          body: body ? Buffer.from(body) : undefined,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if ((res.status >= 500 || res.status === 429) && attempt < RETRIES) {
          await res.body?.cancel();
          await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
          continue;
        }
        return res;
      } catch (e) {
        if (attempt >= RETRIES) throw e;
        await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
      }
    }
  }

  async function fail(op: string, key: string, res: Response): Promise<never> {
    const xml = await res.text().catch(() => "");
    const code = xmlTag(xml, "Code") ?? "";
    throw new Error(`S3 ${op} ${key} failed: ${res.status} ${code}`.trim());
  }

  return {
    async put(key, data, contentType) {
      const res = await send("PUT", buildUrl(key), data, { "content-type": contentType ?? "application/octet-stream" });
      if (!res.ok) await fail("PUT", key, res);
      await res.body?.cancel();
    },
    async get(key) {
      const res = await send("GET", buildUrl(key));
      if (res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok) await fail("GET", key, res);
      return new Uint8Array(await res.arrayBuffer());
    },
    async delete(key) {
      const res = await send("DELETE", buildUrl(key));
      if (!res.ok && res.status !== 404) await fail("DELETE", key, res);
      await res.body?.cancel();
    },
    async *list() {
      let token: string | undefined;
      do {
        const query: Record<string, string> = { "list-type": "2" };
        if (prefix) query.prefix = prefix;
        if (token) query["continuation-token"] = token;
        const res = await send("GET", buildUrl("", query));
        if (!res.ok) await fail("LIST", prefix || "/", res);
        const xml = await res.text();
        for (const [, entry] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const fullKey = xmlTag(entry, "Key");
          const modified = xmlTag(entry, "LastModified");
          if (!fullKey?.startsWith(prefix) || !modified) continue;
          const key = fullKey.slice(prefix.length);
          if (!key.includes("/")) yield { key, lastModified: new Date(modified) } satisfies StoredObject;
        }
        token = xmlTag(xml, "IsTruncated") === "true" ? xmlTag(xml, "NextContinuationToken") : undefined;
      } while (token);
    },
  };
}

/** S3 configuration from the environment (MEDIA_STORAGE=s3). */
export function s3ConfigFromEnv(env: Record<string, string | undefined> = process.env): S3Config {
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is required for MEDIA_STORAGE=s3`);
    return value;
  };
  return {
    endpoint: required("S3_ENDPOINT"),
    region: env.S3_REGION || "us-east-1",
    bucket: required("S3_BUCKET"),
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    prefix: env.S3_PREFIX ?? "",
  };
}
