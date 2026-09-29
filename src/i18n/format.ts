import type { Locale } from "./config";

export const intlLocale = (l: Locale) => (l === "de" ? "de-DE" : "en-GB");

export const formatDate = (d: Date, l: Locale) =>
  d.toLocaleDateString(intlLocale(l), { day: "2-digit", month: "2-digit", year: "numeric" });

export const formatDateTime = (d: Date, l: Locale) =>
  d.toLocaleString(intlLocale(l), { dateStyle: "short", timeStyle: "short" });

export const formatEur = (cents: number, l: Locale) =>
  new Intl.NumberFormat(intlLocale(l), { style: "currency", currency: "EUR" }).format(cents / 100);

export const formatUsd = (microUsd: number, l: Locale) =>
  new Intl.NumberFormat(intlLocale(l), { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(
    microUsd / 1_000_000,
  );
