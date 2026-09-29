import "server-only";
import { and, asc, desc, eq, gt, isNull, lt, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import type { CreditSource } from "@/db/schema";
import { HOLD_TTL_MINUTES, PRICE_LIST_VERSION } from "./catalog";

// Credit ledger. All balance changes go through this module.
//
// - Credits live in "lots" (one per purchase / grant), each with its own expiry.
// - Spending first *reserves* credits (a hold), then *captures* the final amount or *releases* it.
//   Lots are row-locked (SELECT … FOR UPDATE), so parallel requests can never overspend.
// - `credit_transactions` is append-only and is what users see as their history.

const { creditLots: lots, creditHolds: holds, creditTransactions: txns } = schema;

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/** Runs `fn` in the given transaction, or opens a new one. */
function inTx<T>(ex: Executor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return ex === db ? db.transaction(fn) : fn(ex as Tx);
}

export class InsufficientCreditsError extends Error {
  constructor(
    readonly required: number,
    readonly available: number,
  ) {
    super(`Insufficient credits: required ${required}, available ${available}`);
    this.name = "InsufficientCreditsError";
  }
}

export class HoldNotActiveError extends Error {
  constructor(holdId: string) {
    super(`Credit hold ${holdId} is not active`);
    this.name = "HoldNotActiveError";
  }
}

function assertPositiveInt(n: number, what: string) {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError(`${what} must be a positive integer, got ${n}`);
}

const usableLots = (userId: string, now: Date) =>
  and(eq(lots.userId, userId), gt(lots.remaining, 0), or(isNull(lots.expiresAt), gt(lots.expiresAt, now)));

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Spendable credits right now (expired lots and held credits are not included). */
export async function getBalance(userId: string, ex: Executor = db): Promise<number> {
  const [row] = await ex
    .select({ total: sql<number>`coalesce(sum(${lots.remaining}), 0)::int` })
    .from(lots)
    .where(usableLots(userId, new Date()));
  return row.total;
}

/** Lots that still hold credits, soonest-expiring first (the order they are spent in). */
export function getActiveLots(userId: string) {
  return db
    .select()
    .from(lots)
    .where(usableLots(userId, new Date()))
    .orderBy(sql`${lots.expiresAt} asc nulls last`, asc(lots.createdAt));
}

export function getHistory(userId: string, limit = 50) {
  return db
    .select()
    .from(txns)
    .where(eq(txns.userId, userId))
    .orderBy(desc(txns.createdAt), desc(txns.id))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Granting (purchases, subscriptions, promos, test credits)
// ---------------------------------------------------------------------------

export type GrantInput = {
  userId: string;
  amount: number;
  source: CreditSource;
  /** Must be unique per real-world event (e.g. "purchase:<id>"). Re-granting the same ref is a no-op. */
  externalRef: string;
  expiresAt: Date | null;
  note?: string;
};

export async function grantCredits(input: GrantInput, ex: Executor = db) {
  assertPositiveInt(input.amount, "amount");
  return inTx(ex, async (tx) => {
    const lotId = nanoid();
    const inserted = await tx
      .insert(lots)
      .values({
        id: lotId,
        userId: input.userId,
        source: input.source,
        granted: input.amount,
        remaining: input.amount,
        expiresAt: input.expiresAt,
        externalRef: input.externalRef,
        note: input.note,
      })
      .onConflictDoNothing({ target: lots.externalRef })
      .returning({ id: lots.id });

    if (!inserted.length) {
      const [existing] = await tx.select({ id: lots.id }).from(lots).where(eq(lots.externalRef, input.externalRef));
      return { lotId: existing.id, created: false };
    }
    await tx.insert(txns).values({
      id: nanoid(),
      userId: input.userId,
      kind: "grant",
      delta: input.amount,
      lotId,
      action: input.source,
    });
    return { lotId, created: true };
  });
}

// ---------------------------------------------------------------------------
// Spending: reserve → capture | release
// ---------------------------------------------------------------------------

export type ReserveInput = { userId: string; amount: number; action: string; appId?: string | null };

/** Reserves credits for an action. Throws InsufficientCreditsError if the balance is too low. */
export async function reserveCredits(input: ReserveInput): Promise<string> {
  assertPositiveInt(input.amount, "amount");
  await sweepExpired(input.userId);

  return db.transaction(async (tx) => {
    const now = new Date();
    // Lock the user's usable lots. A concurrent reservation waits here and then sees the updated amounts.
    const available = await tx
      .select({ id: lots.id, remaining: lots.remaining })
      .from(lots)
      .where(usableLots(input.userId, now))
      .orderBy(sql`${lots.expiresAt} asc nulls last`, asc(lots.createdAt))
      .for("update");

    const total = available.reduce((sum, l) => sum + l.remaining, 0);
    if (total < input.amount) throw new InsufficientCreditsError(input.amount, total);

    const allocations: { lotId: string; amount: number }[] = [];
    let left = input.amount;
    for (const lot of available) {
      if (left === 0) break;
      const take = Math.min(lot.remaining, left);
      await tx.update(lots).set({ remaining: sql`${lots.remaining} - ${take}` }).where(eq(lots.id, lot.id));
      allocations.push({ lotId: lot.id, amount: take });
      left -= take;
    }

    const holdId = nanoid();
    await tx.insert(holds).values({
      id: holdId,
      userId: input.userId,
      appId: input.appId ?? null,
      action: input.action,
      amount: input.amount,
      allocations,
      expiresAt: new Date(now.getTime() + HOLD_TTL_MINUTES * 60 * 1000),
    });
    return holdId;
  });
}

/** Gives `quantity` credits back to the lots they came from (last-drawn lot first). */
async function returnToLots(tx: Tx, allocations: { lotId: string; amount: number }[], quantity: number) {
  let left = quantity;
  for (const a of [...allocations].reverse()) {
    if (left === 0) break;
    const give = Math.min(a.amount, left);
    await tx.update(lots).set({ remaining: sql`${lots.remaining} + ${give}` }).where(eq(lots.id, a.lotId));
    left -= give;
  }
}

async function lockActiveHold(tx: Tx, holdId: string) {
  const [hold] = await tx.select().from(holds).where(eq(holds.id, holdId)).for("update");
  if (!hold || hold.status !== "held") throw new HoldNotActiveError(holdId);
  return hold;
}

/**
 * Charges `amount` (≤ reserved) and returns the rest. Pass the transaction that also saves the
 * action's result, so the user is charged if and only if they get the result.
 */
export async function captureHold(holdId: string, amount: number, ex: Executor = db) {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError(`amount must be a non-negative integer`);
  return inTx(ex, async (tx) => {
    const hold = await lockActiveHold(tx, holdId);
    if (amount > hold.amount) throw new RangeError(`Cannot capture ${amount}, only ${hold.amount} reserved`);
    await returnToLots(tx, hold.allocations, hold.amount - amount);
    await tx
      .update(holds)
      .set({ status: amount > 0 ? "captured" : "released", captured: amount, settledAt: new Date() })
      .where(eq(holds.id, holdId));
    if (amount > 0) {
      await tx.insert(txns).values({
        id: nanoid(),
        userId: hold.userId,
        kind: "charge",
        delta: -amount,
        holdId,
        appId: hold.appId,
        action: hold.action,
        priceListVersion: PRICE_LIST_VERSION,
      });
    }
  });
}

/** Returns all reserved credits (action failed or was cancelled). */
export async function releaseHold(holdId: string, ex: Executor = db) {
  return inTx(ex, async (tx) => {
    const hold = await lockActiveHold(tx, holdId);
    await returnToLots(tx, hold.allocations, hold.amount);
    await tx.update(holds).set({ status: "released", captured: 0, settledAt: new Date() }).where(eq(holds.id, holdId));
  });
}

// ---------------------------------------------------------------------------
// Housekeeping – safe to call any time (also from a cron job later)
// ---------------------------------------------------------------------------

/** Releases stale holds and expires lots past their expiry date. */
export async function sweepExpired(userId?: string, now = new Date()) {
  const stale = await db
    .select({ id: holds.id })
    .from(holds)
    .where(and(eq(holds.status, "held"), lt(holds.expiresAt, now), userId ? eq(holds.userId, userId) : undefined));
  for (const h of stale) {
    await releaseHold(h.id).catch((e) => {
      if (!(e instanceof HoldNotActiveError)) throw e; // settled concurrently – fine
    });
  }

  await db.transaction(async (tx) => {
    const expired = await tx
      .select({ id: lots.id, userId: lots.userId, remaining: lots.remaining })
      .from(lots)
      .where(and(gt(lots.remaining, 0), lte(lots.expiresAt, now), userId ? eq(lots.userId, userId) : undefined))
      .for("update");
    for (const lot of expired) {
      await tx.update(lots).set({ remaining: 0 }).where(eq(lots.id, lot.id));
      await tx.insert(txns).values({
        id: nanoid(),
        userId: lot.userId,
        kind: "expire",
        delta: -lot.remaining,
        lotId: lot.id,
        action: "expire",
      });
    }
  });
}

/** Consistency check used by tests and the dev dashboard. `ok` must always be true. */
export async function checkLedgerInvariant(userId: string) {
  const [[ledger], [lotSum], [held]] = await Promise.all([
    db.select({ v: sql<number>`coalesce(sum(${txns.delta}), 0)::int` }).from(txns).where(eq(txns.userId, userId)),
    db.select({ v: sql<number>`coalesce(sum(${lots.remaining}), 0)::int` }).from(lots).where(eq(lots.userId, userId)),
    db
      .select({ v: sql<number>`coalesce(sum(${holds.amount}), 0)::int` })
      .from(holds)
      .where(and(eq(holds.userId, userId), eq(holds.status, "held"))),
  ]);
  return { ledger: ledger.v, lots: lotSum.v, held: held.v, ok: ledger.v === lotSum.v + held.v };
}
