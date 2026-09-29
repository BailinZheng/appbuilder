"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import { SECTIONS, TONES, type EditRequest, type SiteSnapshot } from "@/lib/ai/types";
import { ACTION_PRICES, METERED_INSTRUCTION } from "@/lib/billing/catalog";
import { aiEditAction, undoAiChangeAction, type EditResult } from "../../ai-actions";
import { aiErrorText } from "../../generate-form";

type Props = {
  appId: string;
  initialBalance: number;
  initialCanUndo: boolean;
  dirty: boolean;
  onApplied: (site: SiteSnapshot) => void;
};

export function AiPanel({ appId, initialBalance, initialCanUndo, dirty, onApplied }: Props) {
  const { t } = useI18n();
  const [balance, setBalance] = useState(initialBalance);
  const [canUndo, setCanUndo] = useState(initialCanUndo);
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState<EditResult | { undone: true } | null>(null);
  const [pending, start] = useTransition();
  const disabled = pending || dirty;

  const run = (request: EditRequest) =>
    start(async () => {
      const res = await aiEditAction(appId, request);
      setResult(res);
      if (res.ok) {
        setBalance(res.balance);
        setCanUndo(res.canUndo);
        if (res.charged > 0) onApplied(res.site);
        if (request.kind === "instruction" && res.charged > 0) setInstruction("");
      }
    });

  const undo = () =>
    start(async () => {
      const res = await undoAiChangeAction(appId);
      if (res.ok) {
        onApplied(res.site);
        setCanUndo(res.canUndo);
        setResult({ undone: true });
      } else setResult(res);
    });

  const price = (n: number) => <span className="ml-1 text-xs opacity-70">· {n}</span>;
  const chip = "rounded-lg border bg-white px-2.5 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border bg-white p-3">
        <span className="text-sm text-zinc-600">{t.billing.balance}</span>
        <Link href="/dashboard/billing" className="font-semibold underline decoration-dotted" data-testid="ai-balance">
          {t.billing.credits(balance)}
        </Link>
      </div>

      <p className="rounded-lg bg-violet-50 p-2.5 text-xs text-violet-800">{t.ai.demoNote}</p>
      {dirty && <p className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-800">{t.ai.saveFirst}</p>}

      <div className="space-y-3 rounded-xl border bg-white p-4">
        <button disabled={disabled} onClick={() => run({ kind: "redesign" })} className={`${chip} w-full py-2 font-medium`}>
          ✨ {t.ai.redesign} {price(ACTION_PRICES.redesign)}
        </button>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase text-zinc-500">
            {t.ai.addSection} · {t.ai.credits(ACTION_PRICES.add_section)}
          </p>
          <div className="flex flex-wrap gap-2">
            {SECTIONS.map((s) => (
              <button key={s} disabled={disabled} onClick={() => run({ kind: "add_section", section: s })} className={chip}>
                + {t.ai.sections[s]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase text-zinc-500">
            {t.ai.rewrite} · {t.ai.credits(ACTION_PRICES.rewrite)}
          </p>
          <div className="flex flex-wrap gap-2">
            {TONES.map((tone) => (
              <button key={tone} disabled={disabled} onClick={() => run({ kind: "rewrite", tone })} className={chip}>
                {t.ai.tones[tone]}
              </button>
            ))}
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (instruction.trim().length >= 2) run({ kind: "instruction", text: instruction });
          }}
          className="space-y-2"
        >
          <p className="text-xs font-semibold uppercase text-zinc-500">
            {t.ai.instruction} · {t.ai.maxCredits(METERED_INSTRUCTION.max)}
          </p>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder={t.ai.instructionPlaceholder}
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />
          <button disabled={disabled || instruction.trim().length < 2} className="w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white disabled:opacity-40">
            {t.ai.send}
          </button>
        </form>
      </div>

      <div aria-live="polite" className="min-h-6 text-sm">
        {pending && <p className="animate-pulse text-violet-700">{t.ai.working}</p>}
        {!pending && result && "undone" in result && <p className="text-zinc-700">{t.ai.undone}</p>}
        {!pending && result && "ok" in result && result.ok && (
          <p className="text-zinc-700" data-testid="ai-result">
            {result.summary} <strong>{result.charged > 0 ? t.ai.charged(result.charged) : t.ai.notCharged}</strong>
          </p>
        )}
        {!pending && result && "ok" in result && !result.ok && (
          <p className="text-red-600">
            {aiErrorText(t, result.error)}{" "}
            {result.error.code === "insufficient" && (
              <Link href="/dashboard/billing" className="underline">{t.ai.buyMore}</Link>
            )}
          </p>
        )}
      </div>

      {canUndo && (
        <button disabled={pending} onClick={undo} className="text-sm text-zinc-600 underline disabled:opacity-50">
          ↶ {t.ai.undo}
        </button>
      )}
    </div>
  );
}
