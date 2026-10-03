import "server-only";
import { mockProvider } from "./mock-provider";
import type { AiProvider } from "./types";

/**
 * AI_PROVIDER=mock      (default) deterministic demo AI, no external calls, simulated token usage
 * AI_PROVIDER=anthropic TODO – Claude via @anthropic-ai/sdk: structured outputs for generateSite,
 *                       strict patch tools (see patches.ts) for editSite, prompt caching on the
 *                       shared system prompt. Must return real `usage` so billing stays accurate.
 *                       Reference URLs (brief.existingSiteUrl / inspirationUrl): read them with the
 *                       server-side web_fetch tool (runs on Anthropic's side, not our servers) and
 *                       instruct the model to take only facts from the existing site and only the
 *                       general style (colours, layout, tone) from the inspiration site – never
 *                       copy its texts, images, logos or brand names.
 */
export function getAiProvider(): AiProvider {
  const id = process.env.AI_PROVIDER ?? "mock";
  if (id === "mock") return mockProvider;
  throw new Error(`AI provider "${id}" is not implemented yet`);
}
