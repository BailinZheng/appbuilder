"use server";

import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { db, schema } from "@/db";
import { auth } from "@/lib/auth";
import { isLocale, LOCALE_COOKIE } from "./config";

export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  // Signed in? Then e-mails (e.g. hosting reminders) follow the new language too.
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) await db.update(schema.user).set({ locale }).where(eq(schema.user.id, session.user.id));
}
