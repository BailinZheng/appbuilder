import "server-only";
import { mockProvider } from "./mock-provider";
import type { AiProvider } from "./types";

/**
 * AI_PROVIDER=mock      (default) deterministic demo AI, no external calls, simulated token usage
 * AI_PROVIDER=anthropic TODO – Claude via @anthropic-ai/sdk: structured outputs for generateSite,
 *                       strict patch tools (see patches.ts) for editSite, prompt caching on the
 *                       shared system prompt. Must return real `usage` so billing stays accurate.
 */
export function getAiProvider(): AiProvider {
  const id = process.env.AI_PROVIDER ?? "mock";
  if (id === "mock") return mockProvider;
  throw new Error(`AI provider "${id}" is not implemented yet`);
}
