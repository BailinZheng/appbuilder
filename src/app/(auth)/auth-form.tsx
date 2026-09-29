"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useI18n } from "@/i18n/client";

type AuthError = { code?: string; status?: number };

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState<AuthError | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    const res =
      mode === "sign-up"
        ? await authClient.signUp.email({ email, password, name: String(f.get("name")) })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (res.error) return setError(res.error);
    router.push("/dashboard");
    router.refresh();
  }

  // Better Auth returns English messages – show our own translation based on the error code.
  const errorText = (err: AuthError) => {
    const e = t.auth.errors;
    if (err.status === 429) return e.TOO_MANY_REQUESTS;
    if (err.code?.startsWith("USER_ALREADY_EXISTS")) return e.USER_ALREADY_EXISTS;
    return err.code && err.code in e ? e[err.code as keyof typeof e] : e.generic;
  };

  const input = "w-full rounded-lg border bg-white px-3 py-2";
  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-3 rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold">{mode === "sign-up" ? t.auth.signUpTitle : t.auth.signInTitle}</h1>
        {mode === "sign-up" && <input name="name" required placeholder={t.auth.name} className={input} />}
        <input name="email" type="email" required placeholder={t.auth.email} className={input} />
        <input
          name="password"
          type="password"
          required
          minLength={10}
          placeholder={t.auth.password}
          className={input}
        />
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
