import "server-only";
import { createAnthropicProvider } from "./anthropic-provider";
import { mockProvider } from "./mock-provider";
import type { AiProvider } from "./types";

/**
 * AI_PROVIDER=mock      (default) deterministic demo AI, no external calls, simulated token usage
 * AI_PROVIDER=anthropic Claude via @anthropic-ai/sdk (needs ANTHROPIC_API_KEY; optional ANTHROPIC_MODEL),
 *                       see anthropic-provider.ts
 */
let anthropic: AiProvider | undefined;

export function getAiProvider(): AiProvider {
  const id = process.env.AI_PROVIDER ?? "mock";
  if (id === "mock") return mockProvider;
  if (id === "anthropic") return (anthropic ??= createAnthropicProvider());
  throw new Error(`Unknown AI provider "${id}"`);
}
