"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useI18n } from "@/i18n/client";

type AuthError = { code?: string; status?: number };

/** Where the confirmation link in the e-mail leads (after Better Auth has verified the token). */
export const VERIFIED_PAGE = "/email-verified";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState<AuthError | null>(null);
  const [pending, setPending] = useState(false);
  // Set when a confirmation link has been sent: shows the "check your inbox" panel.
  const [awaiting, setAwaiting] = useState<{ email: string; afterSignIn: boolean } | null>(null);
  const [resent, setResent] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    if (mode === "sign-up") {
      const res = await authClient.signUp.email({ email, password, name: String(f.get("name")), callbackURL: VERIFIED_PAGE });
      setPending(false);
      if (res.error) return setError(res.error);
      return setAwaiting({ email, afterSignIn: false });
    }
    const res = await authClient.signIn.email({ email, password });
    if (res.error?.code === "EMAIL_NOT_VERIFIED") {
      await authClient.sendVerificationEmail({ email, callbackURL: VERIFIED_PAGE });
      setPending(false);
      return setAwaiting({ email, afterSignIn: true });
    }
    setPending(false);
    if (res.error) return setError(res.error);
    router.push("/dashboard");
    router.refresh();
  }

  async function resend() {
    if (!awaiting) return;
    const res = await authClient.sendVerificationEmail({ email: awaiting.email, callbackURL: VERIFIED_PAGE });
    if (res.error) return setError(res.error);
    setResent(true);
  }

  // Better Auth returns English messages – show our own translation based on the error code.
  const errorText = (err: AuthError) => {
    const e = t.auth.errors;
    if (err.status === 429) return e.TOO_MANY_REQUESTS;
    if (err.code?.startsWith("USER_ALREADY_EXISTS")) return e.USER_ALREADY_EXISTS;
    return err.code && err.code in e ? e[err.code as keyof typeof e] : e.generic;
  };

  const card = "w-full max-w-sm space-y-3 rounded-2xl border bg-white p-6 shadow-sm";
  if (awaiting) {
    return (
      <main className="flex flex-1 items-center justify-center px-6">
        <div className={card} role="status">
          <h1 className="text-xl font-bold">📬 {t.auth.checkInboxTitle}</h1>
          {awaiting.afterSignIn && <p className="text-sm font-medium text-amber-800">{t.auth.notVerified}</p>}
          <p className="text-sm text-zinc-600">{t.auth.checkInbox(awaiting.email)}</p>
          {error && <p className="text-sm text-red-600">{errorText(error)}</p>}
          {resent ? (
            <p className="text-sm text-green-700">{t.auth.resent}</p>
          ) : (
            <button onClick={resend} className="w-full rounded-lg border py-2 text-sm font-medium hover:bg-zinc-50">
              {t.auth.resend}
            </button>
          )}
          <p className="text-center text-sm">
            <Link href="/sign-in" className="underline" onClick={() => setAwaiting(null)}>{t.auth.backToSignIn}</Link>
          </p>
        </div>
      </main>
    );
  }

  const input = "w-full rounded-lg border bg-white px-3 py-2";
  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <form onSubmit={onSubmit} className={card}>
        <h1 className="text-xl font-bold">{mode === "sign-up" ? t.auth.signUpTitle : t.auth.signInTitle}</h1>
        {mode === "sign-up" && <input name="name" required placeholder={t.auth.name} className={input} />}
        <input name="email" type="email" required autoComplete="email" placeholder={t.auth.email} className={input} />
        <input
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          placeholder={t.auth.password}
          className={input}
        />
        {mode === "sign-in" && (
          <p className="text-right text-sm">
            <Link href="/forgot-password" className="text-zinc-600 underline">{t.auth.forgotLink}</Link>
          </p>
        )}
        {mode === "sign-up" && (
          <label className="flex gap-2 text-sm text-zinc-600">
            <input type="checkbox" required />
            <span>
              {t.auth.acceptBefore}
              <Link href="/datenschutz" className="underline">{t.auth.acceptLink}</Link>
              {t.auth.acceptAfter}
            </span>
          </label>
        )}
        {error && <p className="text-sm text-red-600">{errorText(error)}</p>}
        <button disabled={pending} className="w-full rounded-lg bg-zinc-900 py-2 font-medium text-white disabled:opacity-60">
          {pending ? "…" : mode === "sign-up" ? t.common.signUp : t.common.signIn}
        </button>
        <p className="text-center text-sm text-zinc-600">
          {mode === "sign-up" ? (
            <>{t.auth.haveAccount} <Link href="/sign-in" className="underline">{t.common.signIn}</Link></>
          ) : (
            <>{t.auth.noAccount} <Link href="/sign-up" className="underline">{t.common.signUp}</Link></>
          )}
        </p>
      </form>
    </main>
  );
}
