import "server-only";
import { cookies } from "next/headers";
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "./config";
import { dictionaries } from "./dictionaries";

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : defaultLocale;
}

/** Dictionary for the current request – use in Server Components and Server Actions. */
export async function getT() {
  return dictionaries[await getLocale()];
}
