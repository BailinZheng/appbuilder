"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { authClient } from "@/lib/auth-client";

const card = "w-full max-w-sm space-y-3 rounded-2xl border bg-white p-6 shadow-sm";
const input = "w-full rounded-lg border bg-white px-3 py-2";
const button = "w-full rounded-lg bg-zinc-900 py-2 font-medium text-white disabled:opacity-60";

/** Asks for a reset link. Always shows the same answer, so it never reveals whether an account exists. */
export function ForgotPasswordForm() {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "pending" | "sent" | "limited">("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("pending");
    const email = String(new FormData(e.currentTarget).get("email"));
    const res = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setState(res.error?.status === 429 ? "limited" : "sent");
  }

  return (
    <form onSubmit={onSubmit} className={card}>
      <h1 className="text-xl font-bold">{t.auth.forgotTitle}</h1>
      {state === "sent" ? (
        <p className="text-sm text-green-700" role="status">{t.auth.resetLinkSent}</p>
      ) : (
        <>
          <p className="text-sm text-zinc-600">{t.auth.forgotIntro}</p>
          <input name="email" type="email" required autoComplete="email" placeholder={t.auth.email} className={input} />
          {state === "limited" && <p className="text-sm text-red-600">{t.auth.errors.TOO_MANY_REQUESTS}</p>}
          <button disabled={state === "pending"} className={button}>
            {state === "pending" ? "…" : t.auth.sendResetLink}
          </button>
        </>
      )}
      <p className="text-center text-sm">
        <Link href="/sign-in" className="underline">{t.auth.backToSignIn}</Link>
      </p>
    </form>
  );
}

/** Sets the new password with the token from the e-mail link. */
export function ResetPasswordForm({ token, invalid }: { token: string | null; invalid: boolean }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "pending" | "done" | "invalid" | "error">(invalid || !token ? "invalid" : "idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    setState("pending");
    const newPassword = String(new FormData(e.currentTarget).get("password"));
    const res = await authClient.resetPassword({ newPassword, token });
    if (!res.error) return setState("done");
    setState(res.error.code === "INVALID_TOKEN" ? "invalid" : "error");
  }

  return (
    <form onSubmit={onSubmit} className={card}>
      <h1 className="text-xl font-bold">{t.auth.resetTitle}</h1>
      {state === "done" ? (
        <>
          <p className="text-sm text-green-700" role="status">{t.auth.resetDone}</p>
          <Link href="/sign-in" className={`${button} block text-center`}>{t.common.signIn}</Link>
        </>
      ) : state === "invalid" ? (
        <>
          <p className="text-sm text-red-600">{t.auth.resetInvalid}</p>
          <Link href="/forgot-password" className="block text-center text-sm underline">{t.auth.requestNewLink}</Link>
        </>
      ) : (
        <>
          <input
            name="password"
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            placeholder={t.auth.newPassword}
            className={input}
          />
          {state === "error" && <p className="text-sm text-red-600">{t.auth.errors.generic}</p>}
          <button disabled={state === "pending"} className={button}>
            {state === "pending" ? "…" : t.auth.savePassword}
          </button>
        </>
      )}
    </form>
  );
}
