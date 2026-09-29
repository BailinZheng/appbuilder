import "server-only";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import { costMicroUsd } from "@/lib/ai/pricing";
import type { AiUsage } from "@/lib/ai/types";
import type { BilledAction } from "./catalog";
import { captureHold, releaseHold, reserveCredits, type Tx } from "./ledger";

type Computed<O> = {
  output: O;
  usage: AiUsage | null;
  /** Final price in credits (≤ reserve). 0 = nothing useful happened → full refund. */
  charge: number;
};

/**
 * The one way to run anything that costs credits:
 *
 *   1. reserve `reserve` credits (fails fast with InsufficientCreditsError)
 *   2. compute()  – the slow part, e.g. the AI call; no database writes here
 *   3. in ONE transaction: charge the final price, record AI usage, commit() the result
 *
 * If anything fails, the reservation is released – the user is charged if and only if
 * they receive the result.
 */
export async function runBilledAction<O, R>(opts: {
  userId: string;
  appId?: string | null;
  action: BilledAction;
  reserve: number;
  provider: string;
  compute: () => Promise<Computed<O>>;
  commit: (tx: Tx, output: O) => Promise<R>;
}): Promise<{ result: R; charged: number; output: O }> {
  const holdId = await reserveCredits({
    userId: opts.userId,
    amount: opts.reserve,
    action: opts.action,
    appId: opts.appId,
  });

  try {
    const { output, usage, charge } = await opts.compute();
    const result = await db.transaction(async (tx) => {
      if (charge > 0) await captureHold(holdId, charge, tx);
      else await releaseHold(holdId, tx);
      if (usage) {
        await tx.insert(schema.aiUsage).values({
          id: nanoid(),
          userId: opts.userId,
          appId: opts.appId ?? null,
          holdId,
          action: opts.action,
          provider: opts.provider,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          costMicroUsd: costMicroUsd(usage),
          creditsCharged: charge,
        });
      }
      return charge > 0 ? opts.commit(tx, output) : (undefined as R);
    });
    return { result, charged: charge, output };
  } catch (error) {
    await releaseHold(holdId).catch(() => {}); // already settled → nothing to release
    throw error;
  }
}
