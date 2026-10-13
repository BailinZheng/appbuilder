import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "@/db";
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "@/i18n/config";
import { sendMailInBackground } from "@/lib/mail/mailer";
import { resetPasswordMail, verifyEmailMail } from "@/lib/mail/templates";

/** Language for an auth e-mail: the UI language of the current request, else the one stored on the user. */
function mailLocale(user: object, h?: Headers | null): Locale {
  const fromCookie = h?.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`))?.[1];
  if (isLocale(fromCookie)) return fromCookie;
  const stored = "locale" in user ? user.locale : undefined;
  return isLocale(stored) ? stored : defaultLocale;
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  user: {
    additionalFields: {
      locale: { type: "string", required: false, defaultValue: defaultLocale, input: false },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    // No session until the address is confirmed – this also backs the free-preview limit per account.
    requireEmailVerification: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    // Mails are sent in the background so the response time does not reveal whether an account exists.
    sendResetPassword: async ({ user, url }, request) => {
      sendMailInBackground(resetPasswordMail(mailLocale(user, request?.headers), user, url), "password reset");
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    // Signing in unconfirmed: the sign-in form requests a fresh link itself (with the right return page).
    autoSignInAfterVerification: true,
    expiresIn: 24 * 60 * 60,
    sendVerificationEmail: async ({ user, url }, request) => {
      sendMailInBackground(verifyEmailMail(mailLocale(user, request?.headers), user, url), "verification");
    },
  },
  databaseHooks: {
    user: {
      create: {
        // Remember the UI language the account was created in (used for hosting reminders).
        before: async (user, ctx) => ({ data: { ...user, locale: mailLocale(user, ctx?.request?.headers ?? ctx?.headers) } }),
      },
    },
  },
  rateLimit: { enabled: true },
  telemetry: { enabled: false },
  plugins: [nextCookies()],
});

/** Use in every server page/action that needs a logged-in user. */
export async function requireUser() {
  // Loaded on use, so this module (the auth config) can also be imported by scripts and tests.
  const [{ headers }, { redirect }] = await Promise.all([import("next/headers"), import("next/navigation")]);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return redirect("/sign-in");
  return session.user;
}
