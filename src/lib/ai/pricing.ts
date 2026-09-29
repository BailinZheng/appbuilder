import { CREDIT_VALUE_EUR_CENTS, METERED_INSTRUCTION, USD_TO_EUR } from "@/lib/billing/catalog";
import type { AiUsage } from "./types";

/** Anthropic list prices in USD per million tokens (cache write = 1.25 × input for the 5-minute TTL). */
export const MODEL_PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** Cost in micro-dollars. Conveniently, tokens × ($ per million tokens) = micro-dollars. */
export function costMicroUsd(usage: AiUsage): number {
  const p = MODEL_PRICES[usage.model];
  if (!p) throw new Error(`No price configured for model ${usage.model}`);
  return Math.round(
    usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite,
  );
}

/** Credits for a free-form instruction: AI cost × markup, clamped to the advertised range. */
export function creditsForMeteredUsage(microUsd: number): number {
  const eurCents = (microUsd / 1_000_000) * USD_TO_EUR * 100;
  const credits = Math.ceil((eurCents * METERED_INSTRUCTION.markup) / CREDIT_VALUE_EUR_CENTS);
  return Math.min(METERED_INSTRUCTION.max, Math.max(METERED_INSTRUCTION.min, credits));
}
