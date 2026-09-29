"use client";

import { useActionState } from "react";
import { submitContact, type ContactState } from "@/app/s/[slug]/actions";

export function ContactForm({
  slug,
  title,
  submitLabel,
  preview,
}: {
  slug: string;
  title: string;
  submitLabel: string;
  preview?: boolean;
}) {
  const [state, action, pending] = useActionState<ContactState, FormData>(submitContact, {});

  if (state.ok) {
    return <p className="rounded-xl bg-green-50 p-5 text-green-800">Thank you! Your message was sent.</p>;
  }

  const input = "w-full rounded-lg border px-3 py-2";
  return (
    <form action={action} className="space-y-3 rounded-xl border p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <input type="hidden" name="slug" value={slug} />
      <input name="name" required maxLength={200} placeholder="Name" className={input} />
      <input name="email" type="email" required maxLength={200} placeholder="E-mail" className={input} />
      <textarea name="message" required maxLength={5000} rows={4} placeholder="Message" className={input} />
      {/* Honeypot against spam bots – hidden from humans */}
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <label className="flex gap-2 text-sm text-zinc-600">
        <input type="checkbox" name="consent" required />
        <span>I agree that my data will be processed to answer my request (see Datenschutz).</span>
      </label>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        disabled={pending || preview}
        className="rounded-lg px-5 py-2 font-medium text-white disabled:opacity-60"
        style={{ background: "var(--brand)" }}
      >
        {preview ? `${submitLabel} (preview)` : pending ? "…" : submitLabel}
      </button>
    </form>
  );
}
