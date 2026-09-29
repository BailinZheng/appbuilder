"use client";

import { createContext, useContext } from "react";
import { defaultLocale, type Locale } from "./config";
import { dictionaries } from "./dictionaries";

const LocaleContext = createContext<Locale>(defaultLocale);

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** Current locale and dictionary – use in Client Components. */
export function useI18n() {
  const locale = useContext(LocaleContext);
  return { locale, t: dictionaries[locale] };
}
