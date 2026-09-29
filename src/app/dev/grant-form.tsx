"use client";

import { useActionState } from "react";
import { useI18n } from "@/i18n/client";
import { grantTestCreditsAction, type GrantState } from "./actions";

export function GrantForm({ users }: { users: { id: string; email: string }[] }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<GrantState, FormData>(grantTestCreditsAction, {});
  const input = "w-full rounded-lg border px-3 py-2 text-sm";
  return (
    <form action={action} className="space-y-3">
      <label className="block space-y-1">
        <span className="text-xs font-medium text-zinc-600">{t.dev.user}</span>
        <select name="userId" required className={input}>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.email}</option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-zinc-600">{t.dev.amount}</span>
        <input name="amount" type="number" min={1} max={1000000} step={1} defaultValue={1000} required className={input} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-zinc-600">{t.dev.note}</span>
        <input name="note" maxLength={200} className={input} />
      </label>
      {state.ok && <p className="text-sm text-green-700">{t.dev.granted(state.ok.amount, state.ok.email)}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white disabled:opacity-60">
        {pending ? "…" : t.dev.grant}
      </button>
    </form>
  );
}
