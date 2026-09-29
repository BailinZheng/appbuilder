"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
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
    if (res.error) return setError(res.error.message ?? "Something went wrong");
    router.push("/dashboard");
    router.refresh();
  }

  const input = "w-full rounded-lg border bg-white px-3 py-2";
  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-3 rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold">{mode === "sign-up" ? "Create your account" : "Sign in"}</h1>
        {mode === "sign-up" && <input name="name" required placeholder="Your name" className={input} />}
        <input name="email" type="email" required placeholder="E-mail" className={input} />
        <input
          name="password"
          type="password"
          required
          minLength={10}
          placeholder="Password (min. 10 characters)"
          className={input}
        />
        {mode === "sign-up" && (
          <label className="flex gap-2 text-sm text-zinc-600">
            <input type="checkbox" required />
            <span>
              I accept the terms and the data processing agreement (AVV) and have read the{" "}
              <Link href="/datenschutz" className="underline">privacy policy</Link>.
            </span>
          </label>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={pending} className="w-full rounded-lg bg-zinc-900 py-2 font-medium text-white disabled:opacity-60">
          {pending ? "…" : mode === "sign-up" ? "Sign up" : "Sign in"}
        </button>
        <p className="text-center text-sm text-zinc-600">
          {mode === "sign-up" ? (
            <>Already have an account? <Link href="/sign-in" className="underline">Sign in</Link></>
          ) : (
            <>No account yet? <Link href="/sign-up" className="underline">Sign up</Link></>
          )}
        </p>
      </form>
    </main>
  );
}
