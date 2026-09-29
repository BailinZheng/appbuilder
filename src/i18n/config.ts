export const locales = ["de", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "de";

/** Stores the visitor's chosen UI language. Functional cookie – no consent needed (§ 25 Abs. 2 TDDDG). */
export const LOCALE_COOKIE = "lang";

export const isLocale = (v: unknown): v is Locale => locales.includes(v as Locale);
