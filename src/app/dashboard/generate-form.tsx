"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { Dictionary } from "@/i18n/dictionaries";
import { MAX_REFERENCE_URL_LENGTH, normalizeReferenceUrl } from "@/lib/ai/reference-url";
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
    case "invalidExistingUrl":
    case "invalidInspirationUrl":
      return t.ai[e.code];
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

/** Optional URL input: completes "firma.de" to "https://firma.de/" on blur and flags invalid addresses. */
function ReferenceUrlField({ name, label, hint, serverError }: { name: string; label: string; hint: string; serverError: boolean }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const hintId = `${name}-hint`;
  const showError = invalid || (serverError && value !== "");
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-zinc-600">{label}</span>
      <div className="relative">
        <svg className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        <input
          name={name}
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          maxLength={MAX_REFERENCE_URL_LENGTH}
          placeholder="https://"
          value={value}
          aria-invalid={showError}
          aria-describedby={hintId}
          onChange={(e) => {
            setValue(e.target.value);
            setInvalid(false);
          }}
          onBlur={() => {
            if (!value.trim()) return setValue("");
            const normalized = normalizeReferenceUrl(value);
            if (normalized) setValue(normalized);
            setInvalid(!normalized);
          }}
          className={`w-full rounded-lg border py-2 pr-3 pl-9 text-sm ${showError ? "border-red-400 bg-red-50/40" : ""}`}
        />
      </div>
      <span id={hintId} className={`block text-xs ${showError ? "text-red-600" : "text-zinc-500"}`}>
        {showError ? t.ai.invalidUrl : hint}
      </span>
    </label>
  );
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
      <fieldset className="space-y-3 border-t pt-3">
        <legend className="pr-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.ai.referencesTitle}</legend>
        <ReferenceUrlField
          name="existingSiteUrl"
          label={t.ai.existingSiteUrl}
          hint={t.ai.existingSiteHint}
          serverError={state.error?.code === "invalidExistingUrl"}
        />
        <ReferenceUrlField
          name="inspirationUrl"
          label={t.ai.inspirationUrl}
          hint={t.ai.inspirationHint}
          serverError={state.error?.code === "invalidInspirationUrl"}
        />
      </fieldset>
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
