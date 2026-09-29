// Single source of truth for everything that costs money or credits.
// Changing a price? Bump PRICE_LIST_VERSION – every charge records the version it was made with.

export const PRICE_LIST_VERSION = 1;

/** 1 credit is sold for 1 euro cent (before pack bonuses). */
export const CREDIT_VALUE_EUR_CENTS = 1;

/** Fixed-price AI actions (credits). Users always see the price before they click. */
export const ACTION_PRICES = {
  generate_site: 300,
  redesign: 100,
  add_section: 30,
  rewrite: 10,
} as const;
export type FixedAction = keyof typeof ACTION_PRICES;

/**
 * Free-form AI instructions are billed by actual usage: AI cost × markup, clamped to [min, max].
 * `max` is reserved up front and shown to the user as "max. N credits".
 */
export const METERED_INSTRUCTION = { min: 5, max: 15, markup: 3 } as const;

/** Rough USD→EUR rate used only to convert AI cost into credits for metered actions. */
export const USD_TO_EUR = 0.92;

export type BilledAction = FixedAction | "instruction";

/** Held credits are released automatically if an action never finishes (crash, timeout). */
export const HOLD_TTL_MINUTES = 15;

/** Purchased credits stay valid for 24 months; test credits for 12. */
export const PURCHASED_CREDIT_VALIDITY_MONTHS = 24;
export const TEST_CREDIT_VALIDITY_MONTHS = 12;

/** A published site stays online this many days after its hosting pass ran out. */
export const HOSTING_GRACE_DAYS = 14;

export type CreditPack = { id: string; kind: "credits"; credits: number; priceCents: number; bonusPercent: number };
export type HostingPass = { id: string; kind: "hosting"; months: number; priceCents: number };
export type Product = CreditPack | HostingPass;

export const CREDIT_PACKS: CreditPack[] = [
  { id: "credits_1000", kind: "credits", credits: 1000, priceCents: 1000, bonusPercent: 0 },
  { id: "credits_2750", kind: "credits", credits: 2750, priceCents: 2500, bonusPercent: 10 },
  { id: "credits_6000", kind: "credits", credits: 6000, priceCents: 5000, bonusPercent: 20 },
];

export const HOSTING_PASSES: HostingPass[] = [
  { id: "hosting_3m", kind: "hosting", months: 3, priceCents: 1500 },
  { id: "hosting_12m", kind: "hosting", months: 12, priceCents: 4900 },
];

export const PRODUCTS: Product[] = [...CREDIT_PACKS, ...HOSTING_PASSES];

export function getProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}
