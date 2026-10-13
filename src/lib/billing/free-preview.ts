import "server-only";
import { and, count, eq, gt, isNotNull, lt, or, sql, sum } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import { costMicroUsd } from "@/lib/ai/pricing";
import type { AiUsage } from "@/lib/ai/types";
import { freePreviewLimits, HOLD_TTL_MINUTES } from "./catalog";
import type { Tx } from "./ledger";

// Free AI preview: the counterpart of runBilledAction() for a user's first, free site generation.
//
//   1. claim a slot – quotas are checked and the attempt recorded in ONE transaction under an
//      advisory lock, so parallel requests cannot slip past a limit
//   2. compute()   – the AI call
//   3. in ONE transaction: record AI usage, mark the slot as used, commit() the result
//
// Failed attempts do not use up the user's free preview, but still count towards the per-IP and
// global limits, so repeated failures cannot be used to hammer the AI.

const { freePreviews, aiUsage } = schema;
const DAY_MS = 24 * 60 * 60 * 1000;
const IP_HASH_RETENTION_MS = 2 * DAY_MS;

export type FreePreviewDenial = "used" | "ipLimit" | "unavailable";

export class FreePreviewError extends Error {
  constructor(readonly code: FreePreviewDenial) {
    super(`Free preview denied: ${code}`);
    this.name = "FreePreviewError";
  }
}

/** A slot counts while it succeeded or is still running (pending rows older than the hold TTL are stale). */
const counts = () =>
  or(
    eq(freePreviews.status, "succeeded"),
    and(eq(freePreviews.status, "pending"), gt(freePreviews.createdAt, new Date(Date.now() - HOLD_TTL_MINUTES * 60_000))),
  );

/** Whether the user still has a free preview (does not check the per-IP and global limits). */
export async function hasFreePreview(userId: string): Promise<boolean> {
  if (freePreviewLimits().globalPerDay === 0) return false;
  const [{ n }] = await db
    .select({ n: count() })
    .from(freePreviews)
    .where(and(eq(freePreviews.userId, userId), counts()));
  return n < freePreviewLimits().perUser;
}

async function claim(userId: string, ipHash: string | null): Promise<string> {
  const limits = freePreviewLimits();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('free_previews'))`);
    const now = Date.now();
    const since = new Date(now - DAY_MS);

    const [mine] = await tx
      .select({ n: count() })
      .from(freePreviews)
      .where(and(eq(freePreviews.userId, userId), counts()));
    if (mine.n >= limits.perUser) throw new FreePreviewError("used");

    if (ipHash) {
      const [fromIp] = await tx
        .select({ n: count() })
        .from(freePreviews)
        .where(and(eq(freePreviews.ipHash, ipHash), gt(freePreviews.createdAt, since)));
      if (fromIp.n >= limits.perIpPerDay) throw new FreePreviewError("ipLimit");
    }

    const [all] = await tx
      .select({
        n: count(),
        cost: sum(freePreviews.costMicroUsd).mapWith(Number),
        running: sql<number>`count(*) filter (where ${freePreviews.status} = 'pending')`.mapWith(Number),
      })
      .from(freePreviews)
      .where(gt(freePreviews.createdAt, since));
    const committedUsd = (all.cost ?? 0) / 1_000_000 + all.running * limits.estimatedCostUsd;
    if (all.n >= limits.globalPerDay || committedUsd + limits.estimatedCostUsd > limits.dailyBudgetUsd) {
      throw new FreePreviewError("unavailable");
    }

    const id = nanoid();
    await tx.insert(freePreviews).values({ id, userId, ipHash });
    // Data minimisation: IP hashes are only needed for the daily limit.
    await tx
      .update(freePreviews)
      .set({ ipHash: null })
      .where(and(isNotNull(freePreviews.ipHash), lt(freePreviews.createdAt, new Date(now - IP_HASH_RETENTION_MS))));
    return id;
  });
}

const markFailed = (id: string) =>
  db
    .update(freePreviews)
    .set({ status: "failed", settledAt: new Date() })
    .where(and(eq(freePreviews.id, id), eq(freePreviews.status, "pending")));

export async function runFreePreview<O, R>(opts: {
  userId: string;
  ipHash: string | null;
  appId: string;
  provider: string;
  compute: () => Promise<{ output: O; usage: AiUsage }>;
  commit: (tx: Tx, output: O) => Promise<R>;
}): Promise<{ result: R; output: O }> {
  const id = await claim(opts.userId, opts.ipHash);
  try {
    const { output, usage } = await opts.compute();
    const cost = costMicroUsd(usage);
    const result = await db.transaction(async (tx) => {
      const result = await opts.commit(tx, output);
      await tx.insert(aiUsage).values({
        id: nanoid(),
        userId: opts.userId,
        appId: opts.appId,
        holdId: null,
        action: "free_preview",
        provider: opts.provider,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        costMicroUsd: cost,
        creditsCharged: 0,
      });
      await tx
        .update(freePreviews)
        .set({ status: "succeeded", appId: opts.appId, costMicroUsd: cost, settledAt: new Date() })
        .where(eq(freePreviews.id, id));
      return result;
    });
    return { result, output };
  } catch (error) {
    await markFailed(id).catch(() => {});
    throw error;
  }
}
