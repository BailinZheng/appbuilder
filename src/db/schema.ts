import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { AppDefinition, LegalInfo } from "@/lib/app-definition";
import type { SiteBrief } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// Better Auth tables (field names must match Better Auth's model fields)
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Platform tables
// ---------------------------------------------------------------------------

/** One customer-built app. The whole app is described by `definition` (JSON). */
export const apps = pgTable(
  "apps",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(), // subdomain: <slug>.yourplatform.de
    name: text("name").notNull(),
    themeColor: text("theme_color").notNull().default("#2563eb"),
    definition: jsonb("definition").$type<AppDefinition>().notNull(),
    legal: jsonb("legal").$type<LegalInfo>().notNull(),
    published: boolean("published").notNull().default(false),
    // Paid hosting period (hosting pass). Publicly reachable while in the future (+ grace period).
    hostedUntil: timestamp("hosted_until"),
    // The "Create with AI" form input (incl. reference URLs) – kept for regenerating and the real AI later.
    aiBrief: jsonb("ai_brief").$type<SiteBrief>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("apps_owner_id_idx").on(t.ownerId)],
);

/** Images uploaded by app owners. Files live in the media storage (local disk now, object storage later). */
export const media = pgTable(
  "media",
  {
    id: text("id").primaryKey(), // unguessable – it is part of the public URL
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    originalName: text("original_name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("media_app_id_idx").on(t.appId)],
);

/** Snapshots taken before every AI change – powers the free "undo". */
export const appVersions = pgTable(
  "app_versions",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    themeColor: text("theme_color").notNull(),
    definition: jsonb("definition").$type<AppDefinition>().notNull(),
    reason: text("reason").notNull(), // billed action that replaced this version, e.g. "redesign"
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("app_versions_app_id_idx").on(t.appId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Billing: credits, holds, purchases, AI usage
//
// Invariant (checked in tests):
//   SUM(credit_transactions.delta) = SUM(credit_lots.remaining) + SUM(active hold amounts)
// ---------------------------------------------------------------------------

/** A batch of credits with its own source and expiry. Spending draws from the soonest-expiring lot first. */
export const creditLots = pgTable(
  "credit_lots",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: text("source").$type<CreditSource>().notNull(),
    granted: integer("granted").notNull(),
    remaining: integer("remaining").notNull(),
    expiresAt: timestamp("expires_at"), // null = never expires
    // Unique reference of whatever created the lot (purchase id, test grant id…) – makes grants idempotent.
    externalRef: text("external_ref").notNull().unique(),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("credit_lots_user_idx").on(t.userId, t.expiresAt),
    check("credit_lots_remaining_valid", sql`${t.remaining} >= 0 AND ${t.remaining} <= ${t.granted}`),
    check("credit_lots_granted_positive", sql`${t.granted} > 0`),
  ],
);

/** Credits reserved while an action runs. Captured (charged) on success, released on failure. */
export const creditHolds = pgTable(
  "credit_holds",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    appId: text("app_id").references(() => apps.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    amount: integer("amount").notNull(),
    captured: integer("captured"),
    status: text("status").$type<"held" | "captured" | "released">().notNull().default("held"),
    // Which lots the credits came from, so releases return them to the same lots.
    allocations: jsonb("allocations").$type<{ lotId: string; amount: number }[]>().notNull(),
    expiresAt: timestamp("expires_at").notNull(), // stale holds are released automatically
    createdAt: timestamp("created_at").notNull().defaultNow(),
    settledAt: timestamp("settled_at"),
  },
  (t) => [
    index("credit_holds_user_status_idx").on(t.userId, t.status),
    check("credit_holds_amount_positive", sql`${t.amount} > 0`),
  ],
);

/** Append-only ledger the user sees as their credit history. Never updated or deleted. */
export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"grant" | "charge" | "expire">().notNull(),
    delta: integer("delta").notNull(),
    lotId: text("lot_id").references(() => creditLots.id, { onDelete: "set null" }),
    holdId: text("hold_id").references(() => creditHolds.id, { onDelete: "set null" }),
    appId: text("app_id").references(() => apps.id, { onDelete: "set null" }),
    action: text("action"), // billed action or credit source
    priceListVersion: integer("price_list_version"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("credit_transactions_user_idx").on(t.userId, t.createdAt)],
);

/** A payment for a product (credit pack or hosting pass). Fulfilled exactly once. */
export const purchases = pgTable(
  "purchases",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    appId: text("app_id").references(() => apps.id, { onDelete: "set null" }), // hosting passes only
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("EUR"),
    status: text("status").$type<"pending" | "paid" | "cancelled">().notNull().default("pending"),
    provider: text("provider").$type<"dev" | "stripe">().notNull(),
    providerRef: text("provider_ref").unique(), // e.g. Stripe checkout session id
    createdAt: timestamp("created_at").notNull().defaultNow(),
    paidAt: timestamp("paid_at"),
  },
  (t) => [index("purchases_user_idx").on(t.userId, t.createdAt)],
);

/** Real (or simulated) token usage and cost of every AI call – for margin tracking. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    appId: text("app_id").references(() => apps.id, { onDelete: "set null" }),
    holdId: text("hold_id").references(() => creditHolds.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    provider: text("provider").notNull(), // "mock" | "anthropic"
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull(), // 1 USD = 1,000,000
    creditsCharged: integer("credits_charged").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("ai_usage_user_idx").on(t.userId, t.createdAt)],
);

export type CreditSource = "purchase" | "subscription" | "promo" | "test";

/**
 * Contact-form submissions from end users of a customer's app.
 * GDPR: the platform is the *processor* here; the app owner is the controller.
 */
export const submissions = pgTable(
  "submissions",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("submissions_app_id_idx").on(t.appId)],
);

export type App = typeof apps.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type CreditLot = typeof creditLots.$inferSelect;
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
