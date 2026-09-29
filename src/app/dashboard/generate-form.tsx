"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { Dictionary } from "@/i18n/dictionaries";
import { INDUSTRIES } from "@/lib/ai/types";
import { ACTION_PRICES } from "@/lib/billing/catalog";
import { generateSiteAction, type AiError, type GenerateState } from "./ai-actions";
import { toSlug } from "./slug";

export function aiErrorText(t: Dictionary, e: AiError) {
  switch (e.code) {
    case "insufficient":
      return t.ai.insufficient(e.required, e.available);
    case "invalidBrief":
      return t.ai.invalidBrief;
    case "slugInvalid":
    case "slugReserved":
    case "slugTaken":
      return t.dashboard.errors[e.code];
    case "notFound":
      return t.editor.errors.notFound;
    case "failed":
      return t.ai.failed;
  }
}

export function GenerateForm({ balance }: { balance: number }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<GenerateState, FormData>(generateSiteAction, {});
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const price = ACTION_PRICES.generate_site;
  const input = "w-full rounded-lg border px-3 py-2 text-sm";
  const label = "block space-y-1";
  const caption = "text-xs font-medium text-zinc-600";

  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-zinc-600">{t.ai.generateIntro}</p>
      <label className={label}>
        <span className={caption}>{t.ai.businessName}</span>
        <input
          name="businessName"
          required
          minLength={2}
          maxLength={80}
          className={input}
          onChange={(e) => !touched && setSlug(toSlug(e.target.value))}
        />
      </label>
      <div>
        <input
          name="slug"
          required
          value={slug}
          onChange={(e) => {
            setTouched(true);
            setSlug(e.target.value.toLowerCase());
          }}
          className={input}
          placeholder={t.dashboard.addressPlaceholder}
          aria-label={t.dashboard.addressPlaceholder}
        />
        <p className="mt-1 text-xs text-zinc-500">{slug || t.dashboard.addressPlaceholder}.localhost:3000</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          <span className={caption}>{t.ai.industry}</span>
          <select name="industry" className={input} defaultValue="bakery">
            {INDUSTRIES.map((i) => (
              <option key={i} value={i}>{t.ai.industries[i]}</option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span className={caption}>{t.ai.city}</span>
          <input name="city" maxLength={80} className={input} />
        </label>
      </div>
      <label className={label}>
        <span className={caption}>{t.ai.services}</span>
        <input name="services" maxLength={500} placeholder={t.ai.servicesHint} className={input} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          <span className={caption}>{t.ai.tone}</span>
          <select name="tone" className={input} defaultValue="friendly">
            <option value="friendly">{t.ai.tones.friendly}</option>
            <option value="professional">{t.ai.tones.professional}</option>
          </select>
        </label>
        <label className={label}>
          <span className={caption}>{t.ai.phone}</span>
          <input name="phone" type="tel" maxLength={40} className={input} />
        </label>
      </div>
      {state.error && (
        <p className="text-sm text-red-600">
          {aiErrorText(t, state.error)}{" "}
          {state.error.code === "insufficient" && (
            <Link href="/dashboard/billing" className="underline">{t.ai.buyMore}</Link>
          )}
        </p>
      )}
      <button
        disabled={pending}
        className="w-full rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? t.ai.generating : `✨ ${t.ai.generate(price)}`}
      </button>
      <p className="text-center text-xs text-zinc-500">
        {t.billing.balance}: {t.billing.credits(balance)}
      </p>
    </form>
  );
}
