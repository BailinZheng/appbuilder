import "server-only";
import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getMediaStorage, type MediaStorage } from "./storage";

/**
 * Removes images nobody uses any more (part of the daily job):
 *
 * 1. Unused uploads – media rows older than UNUSED_MEDIA_GRACE_DAYS whose URL appears neither in any app nor in any
 *    undo snapshot (app_versions). They also count towards the per-app image limit, so this frees room.
 * 2. Orphaned files – stored files without a media row, older than ORPHAN_FILE_GRACE_MS: left behind when an app or
 *    account is deleted (the rows cascade, the files do not) or when an upload failed halfway.
 *
 * Database rows are deleted first and files second, so a failure can only leave an orphaned file behind, which the
 * next run removes – never a row that points to a missing file.
 */

export const UNUSED_MEDIA_GRACE_DAYS = 7; // an open editor may hold a fresh upload that is not saved yet
export const ORPHAN_FILE_GRACE_MS = 24 * 60 * 60 * 1000; // a file is stored a moment before its row is inserted
const BATCH = 500;

/** Matches /media/<id>.<ext> in relative and absolute URLs. */
const MEDIA_URL = /\/media\/([A-Za-z0-9_-]{10,40})\.[a-z0-9]+/g;

export function mediaIdsIn(text: string): string[] {
  return [...text.matchAll(MEDIA_URL)].map((m) => m[1]);
}

// Exact text of apps.updated_at – compared for equality, so it does not depend on clocks or time zones.
const appVersionStamp = sql<string>`${schema.apps.updatedAt}::text`;

/**
 * IDs of all images referenced by any app or undo snapshot (read in pages to keep memory flat), and the
 * updated_at stamp each app had when it was read.
 */
export async function referencedMediaIds() {
  const ids = new Set<string>();
  const scannedApps = new Map<string, string>();
  const scan = async (page: (after: string) => Promise<{ id: string; content: string; stamp?: string }[]>) => {
    for (let after = ""; ; ) {
      const rows = await page(after);
      for (const row of rows) {
        for (const id of mediaIdsIn(row.content)) ids.add(id);
        if (row.stamp) scannedApps.set(row.id, row.stamp);
      }
      if (rows.length < BATCH) return;
      after = rows[rows.length - 1].id;
    }
  };
  const { apps, appVersions } = schema;
  await scan((after) =>
    db
      .select({ id: apps.id, content: sql<string>`${apps.definition}::text || ${apps.legal}::text`, stamp: appVersionStamp })
      .from(apps)
      .where(gt(apps.id, after))
      .orderBy(asc(apps.id))
      .limit(BATCH),
  );
  await scan((after) =>
    db
      .select({ id: appVersions.id, content: sql<string>`${appVersions.definition}::text` })
      .from(appVersions)
      .where(gt(appVersions.id, after))
      .orderBy(asc(appVersions.id))
      .limit(BATCH),
  );
  return { ids, scannedApps };
}

async function deleteFiles(storage: MediaStorage, keys: string[]) {
  let failed = 0;
  for (const key of keys) {
    try {
      await storage.delete(key);
    } catch (e) {
      failed++; // stays as an orphaned file and is retried on the next run
      console.error(`[media] could not delete ${key}`, e);
    }
  }
  return failed;
}

export interface MediaCleanupResult {
  unusedDeleted: number;
  orphanedFilesDeleted: number;
  failed: number;
}

export async function cleanupMedia(now = new Date(), storage = getMediaStorage()): Promise<MediaCleanupResult> {
  const { ids: referenced, scannedApps } = await referencedMediaIds();

  // 1. Unused uploads. Images of apps saved since the scan are skipped: their new content was not scanned.
  const cutoff = new Date(now.getTime() - UNUSED_MEDIA_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await db
    .select({ id: schema.media.id, appId: schema.media.appId, stamp: appVersionStamp })
    .from(schema.media)
    .innerJoin(schema.apps, eq(schema.apps.id, schema.media.appId))
    .where(lt(schema.media.createdAt, cutoff));
  const unused = candidates
    .filter((c) => !referenced.has(c.id) && scannedApps.get(c.appId) === c.stamp)
    .map((c) => c.id);

  let unusedDeleted = 0;
  let failed = 0;
  for (let i = 0; i < unused.length; i += BATCH) {
    const deleted = await db
      .delete(schema.media)
      .where(and(inArray(schema.media.id, unused.slice(i, i + BATCH)), lt(schema.media.createdAt, cutoff)))
      .returning({ storageKey: schema.media.storageKey });
    unusedDeleted += deleted.length;
    failed += await deleteFiles(storage, deleted.map((d) => d.storageKey));
  }

  // 2. Orphaned files.
  const orphanCutoff = now.getTime() - ORPHAN_FILE_GRACE_MS;
  let orphanedFilesDeleted = 0;
  let batch: string[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const known = await db
      .select({ storageKey: schema.media.storageKey })
      .from(schema.media)
      .where(inArray(schema.media.storageKey, batch));
    const knownKeys = new Set(known.map((k) => k.storageKey));
    const orphans = batch.filter((key) => !knownKeys.has(key));
    const orphanFailures = await deleteFiles(storage, orphans);
    orphanedFilesDeleted += orphans.length - orphanFailures;
    failed += orphanFailures;
    batch = [];
  };
  for await (const file of storage.list()) {
    if (file.lastModified.getTime() >= orphanCutoff) continue;
    batch.push(file.key);
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  return { unusedDeleted, orphanedFilesDeleted, failed };
}

/** Deletes the files of an app right away (its rows cascade with the app). Failures are left to the cleanup. */
export async function deleteAppMediaFiles(storageKeys: string[], storage = getMediaStorage()) {
  await deleteFiles(storage, storageKeys);
}
