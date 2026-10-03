import { z } from "zod";
import type { Locale } from "@/i18n/config";
import type { AppDefinition } from "@/lib/app-definition";
import type { PatchOp } from "./patches";
import { MAX_REFERENCE_URL_LENGTH, normalizeReferenceUrl } from "./reference-url";

export const INDUSTRIES = ["bakery", "hairdresser", "restaurant", "craftsman", "fitness", "other"] as const;
export type Industry = (typeof INDUSTRIES)[number];

/** Optional reference URL: "" stays "", anything else must normalise to a public http(s) URL. */
const referenceUrl = (message: string) =>
  z
    .string()
    .trim()
    .max(MAX_REFERENCE_URL_LENGTH)
    .default("")
    .transform((v, ctx) => {
      if (!v) return "";
      const url = normalizeReferenceUrl(v);
      if (!url) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return url;
    });

/** What the user fills in on the guided "Create with AI" form. */
export const siteBriefSchema = z.object({
  businessName: z.string().trim().min(2).max(80),
  industry: z.enum(INDUSTRIES),
  city: z.string().trim().max(80),
  services: z.string().trim().max(500),
  tone: z.enum(["friendly", "professional"]),
  phone: z.string().trim().max(40),
  /** The customer's current or previous website – a source for content (services, contact details). */
  existingSiteUrl: referenceUrl("existingSiteUrl"),
  /** A website whose look the customer likes – a source for style only, never for content or logos. */
  inspirationUrl: referenceUrl("inspirationUrl"),
});
export type SiteBrief = z.infer<typeof siteBriefSchema>;

export type SiteSnapshot = { name: string; themeColor: string; definition: AppDefinition };

export const SECTIONS = ["prices", "faq", "team", "cta", "gallery"] as const;
export type Section = (typeof SECTIONS)[number];
export const TONES = ["friendly", "professional", "shorter"] as const;
export type Tone = (typeof TONES)[number];

export type EditRequest =
  | { kind: "redesign" }
  | { kind: "add_section"; section: Section }
  | { kind: "rewrite"; tone: Tone }
  | { kind: "instruction"; text: string };

/** Token usage as reported by the model provider (Anthropic returns these in `response.usage`). */
export type AiUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type AiResult<T> = { output: T; usage: AiUsage };

/**
 * Everything the app needs from an AI model. The mock provider implements it today;
 * an Anthropic provider (structured outputs + strict patch tools) replaces it later
 * without changes to billing, actions or UI.
 */
export interface AiProvider {
  readonly id: "mock" | "anthropic";
  generateSite(brief: SiteBrief, locale: Locale): Promise<AiResult<SiteSnapshot>>;
  editSite(site: SiteSnapshot, request: EditRequest, locale: Locale): Promise<AiResult<{ ops: PatchOp[]; summary: string }>>;
}
