"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/i18n/client";
import { createApp, type CreateState } from "./actions";
import { toSlug } from "./slug";

export function CreateAppForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<CreateState, FormData>(createApp, {});
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const input = "w-full rounded-lg border px-3 py-2";

  return (
    <form action={action} className="space-y-3">
      <input
        name="name"
        required
        placeholder={t.dashboard.namePlaceholder}
        className={input}
        onChange={(e) => !touched && setSlug(toSlug(e.target.value))}
      />
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
        />
        <p className="mt-1 text-xs text-zinc-500">{slug || t.dashboard.addressPlaceholder}.localhost:3000</p>
      </div>
      {state.error && <p className="text-sm text-red-600">{t.dashboard.errors[state.error]}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-zinc-900 py-2 font-medium text-white disabled:opacity-60">
        {pending ? "…" : t.dashboard.createApp}
      </button>
    </form>
  );
}
