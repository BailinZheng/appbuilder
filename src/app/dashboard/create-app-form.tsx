"use client";

import { useActionState, useState } from "react";
import { createApp, type CreateState } from "./actions";

const toSlug = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export function CreateAppForm() {
  const [state, action, pending] = useActionState<CreateState, FormData>(createApp, {});
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const input = "w-full rounded-lg border px-3 py-2";

  return (
    <form action={action} className="space-y-3">
      <input
        name="name"
        required
        placeholder="Business name, e.g. Bäckerei Müller"
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
          placeholder="address"
        />
        <p className="mt-1 text-xs text-zinc-500">{slug || "address"}.localhost:3000</p>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-zinc-900 py-2 font-medium text-white disabled:opacity-60">
        {pending ? "…" : "Create app"}
      </button>
    </form>
  );
}
