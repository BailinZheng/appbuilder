import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Locale } from "@/i18n/config";
import { blockSchema, type Block, type BlockType } from "@/lib/app-definition";
import { EDIT_SYSTEM_PROMPT, editUserMessage, GENERATE_SYSTEM_PROMPT, generateUserMessage } from "./anthropic-prompts";
import { strictJsonSchema } from "./json-schema";
import { applyPatches, PatchError, type PatchOp } from "./patches";
import { MODEL_PRICES } from "./pricing";
import type { AiProvider, AiUsage, SiteBrief, SiteSnapshot } from "./types";

// Claude provider.
//   generateSite – structured output (output_config.format) for the whole site; reference URLs are read
//                  with Anthropic's server-side web_fetch tool, so our servers never fetch customer URLs.
//   editSite     – strict patch tools (one per patch op). Each call is applied to a working copy at once
//                  and the outcome goes back to Claude as the tool result, so it can correct mistakes.
//   caching      – frozen system prompts with a cache breakpoint, plus automatic caching of the growing
//                  conversation inside the edit loop.
// Usage of every request is summed and returned, so billing records the real cost.

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
export type CreateMessage = (params: CreateParams) => Promise<Message>;

export const ANTHROPIC_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"] as const;
const MAX_TOKENS = 16000;
const MAX_EDIT_TURNS = 5; // tool round trips per edit – enough to correct a failed call or two
const MAX_PAUSE_TURNS = 3; // continuations when a server-side web fetch turn is paused
const MAX_FETCHES = 4;
const MAX_FETCH_TOKENS = 15000; // per fetched page
// Server-side fallback when a safety classifier declines (very rare for website texts). The fallback
// model is reported in `response.model` and billed at its own price, see MODEL_PRICES.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class AiResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiResponseError";
  }
}

// ---------------------------------------------------------------------------
// Schemas given to Claude. Block ids are always assigned by us, never by the model.
// ---------------------------------------------------------------------------

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const [heroBlock, textBlock, imageBlock, buttonBlock, hoursBlock, contactBlock] = blockSchema.options;
const newBlockSchema = z.discriminatedUnion("type", [
  heroBlock.omit({ id: true }),
  textBlock.omit({ id: true }),
  imageBlock.omit({ id: true }),
  buttonBlock.omit({ id: true }),
  hoursBlock.omit({ id: true }),
  contactBlock.omit({ id: true }),
]);
type NewBlock = z.infer<typeof newBlockSchema>;

export const generatedSiteSchema = z.object({
  name: z.string().min(2).max(80),
  themeColor: z.string().regex(HEX_COLOR),
  blocks: z.array(newBlockSchema).min(1).max(30),
});

const GENERATED_SITE_JSON_SCHEMA = strictJsonSchema(generatedSiteSchema);

/** Which fields update_block may change, per block type (id and type are immutable). */
export const UPDATABLE_FIELDS = {
  hero: ["title", "subtitle"],
  text: ["heading", "body"],
  image: ["url", "alt"],
  button: ["label", "href"],
  hours: ["title", "lines"],
  contact: ["title", "submitLabel"],
} as const satisfies Record<BlockType, readonly string[]>;

const blockId = z.string().describe("Block id from the site");
const fieldValue = z.string().max(5000).optional();

const PATCH_TOOLS = {
  add_block: {
    description: "Insert a new block. Its id is assigned automatically and returned in the result.",
    input: z.object({
      block: newBlockSchema,
      index: z.number().int().min(0).optional().describe("Position, 0 = first. Omit to append at the end."),
    }),
  },
  update_block: {
    description:
      "Change fields of an existing block. Only send the fields that change, and only fields that exist on that block type: " +
      Object.entries(UPDATABLE_FIELDS)
        .map(([type, fields]) => `${type} (${fields.join(", ")})`)
        .join(", ") +
      ".",
    input: z.object({
      id: blockId,
      fields: z.object({
        title: fieldValue,
        subtitle: fieldValue,
        heading: fieldValue,
        body: fieldValue,
        url: fieldValue,
        alt: fieldValue,
        label: fieldValue,
        href: fieldValue,
        lines: fieldValue,
        submitLabel: fieldValue,
      }),
    }),
  },
  remove_block: { description: "Remove a block.", input: z.object({ id: blockId }) },
  move_block: {
    description: "Move a block to a new position (0 = first), counted after removing it from its old position.",
    input: z.object({ id: blockId, index: z.number().int().min(0) }),
  },
  set_theme: {
    description: "Set the site's theme colour.",
    input: z.object({ themeColor: z.string().regex(HEX_COLOR).describe("Hex colour, e.g. #b45309") }),
  },
  set_name: {
    description: "Rename the site (shown in the browser tab and as the installed app's name).",
    input: z.object({ name: z.string().min(2).max(80) }),
  },
} satisfies Record<PatchOp["op"], { description: string; input: z.ZodObject }>;
type PatchToolName = keyof typeof PATCH_TOOLS;

/** Strict tool definitions; constraints the API does not enforce (lengths, patterns) are checked here. */
export const PATCH_TOOL_DEFINITIONS: Anthropic.Beta.Messages.BetaTool[] = Object.entries(PATCH_TOOLS).map(
  ([name, tool]) => ({
    name,
    description: tool.description,
    strict: true,
    input_schema: strictJsonSchema(tool.input) as Anthropic.Beta.Messages.BetaTool.InputSchema,
  }),
);

const newId = () => Math.random().toString(36).slice(2, 10);
const withId = (block: NewBlock): Block => ({ id: newId(), ...block });

/** Validates a patch tool call against the current site and turns it into a PatchOp. Throws on invalid input. */
export function toPatchOp(name: string, input: unknown, site: SiteSnapshot): PatchOp {
  if (!(name in PATCH_TOOLS)) throw new PatchError(`Unknown tool ${name}`);
  const op = name as PatchToolName;
  switch (op) {
    case "add_block": {
      const v = PATCH_TOOLS.add_block.input.parse(input);
      return { op, block: withId(v.block), index: v.index };
    }
    case "update_block": {
      const v = PATCH_TOOLS.update_block.input.parse(input);
      const block = site.definition.blocks.find((b) => b.id === v.id);
      if (!block) throw new PatchError(`Unknown block ${v.id}`);
      const allowed: readonly string[] = UPDATABLE_FIELDS[block.type];
      const fields = Object.fromEntries(Object.entries(v.fields).filter(([, value]) => value !== undefined)) as Record<string, string>;
      const wrong = Object.keys(fields).filter((k) => !allowed.includes(k));
      if (wrong.length) throw new PatchError(`A ${block.type} block has no field ${wrong.join(", ")}. Allowed: ${allowed.join(", ")}`);
      if (!Object.keys(fields).length) throw new PatchError("No fields to change");
      return { op, id: v.id, fields };
    }
    case "remove_block":
      return { op, ...PATCH_TOOLS.remove_block.input.parse(input) };
    case "move_block":
      return { op, ...PATCH_TOOLS.move_block.input.parse(input) };
    case "set_theme":
      return { op, ...PATCH_TOOLS.set_theme.input.parse(input) };
    case "set_name":
      return { op, ...PATCH_TOOLS.set_name.input.parse(input) };
  }
}

function describeOp(op: PatchOp): string {
  switch (op.op) {
    case "add_block":
      return `Added ${op.block.type} block with id ${op.block.id}.`;
    case "update_block":
      return `Updated block ${op.id}.`;
    case "remove_block":
      return `Removed block ${op.id}.`;
    case "move_block":
      return `Moved block ${op.id} to position ${op.index}.`;
    case "set_theme":
      return `Theme colour is now ${op.themeColor}.`;
    case "set_name":
      return `Site name is now ${op.name}.`;
  }
}

const errorText = (e: unknown) =>
  e instanceof z.ZodError ? z.prettifyError(e) : e instanceof Error ? e.message : "Invalid call";

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** Hosts the web fetch tool may read: only the customer's reference sites (and their subdomains). */
export function referenceDomains(brief: SiteBrief): string[] {
  const hosts = [brief.existingSiteUrl, brief.inspirationUrl]
    .filter(Boolean)
    .map((url) => new URL(url).hostname.toLowerCase().replace(/^www\./, ""));
  return [...new Set(hosts)];
}

function addUsage(total: AiUsage, response: Message, defaultModel: string) {
  const u = response.usage;
  total.inputTokens += u.input_tokens;
  total.outputTokens += u.output_tokens;
  total.cacheReadTokens += u.cache_read_input_tokens ?? 0;
  total.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
  // If a fallback model served any request, bill everything at that model's price.
  if (response.model !== defaultModel) total.model = response.model in MODEL_PRICES ? response.model : total.model;
}

/** Throws if the response cannot be used. Text inside a refused or truncated response is never trusted. */
function assertUsable(response: Message) {
  if (response.stop_reason === "refusal") throw new AiResponseError(`Refused (${response.stop_details?.category ?? "unknown"})`);
  if (response.stop_reason === "max_tokens") throw new AiResponseError("Response hit max_tokens");
}

const textOf = (response: Message) =>
  response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join(" ")
    .trim();

const FALLBACK_SUMMARY: Record<Locale, string> = { de: "Änderungen übernommen.", en: "Changes applied." };
const MAX_SUMMARY_LENGTH = 400;

export function createAnthropicProvider(opts: { create?: CreateMessage; model?: string } = {}): AiProvider {
  const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? ANTHROPIC_MODELS[0];
  if (!(ANTHROPIC_MODELS as readonly string[]).includes(model)) throw new Error(`Unsupported ANTHROPIC_MODEL "${model}"`);

  let client: Anthropic | undefined;
  const create: CreateMessage =
    opts.create ??
    ((params) => {
      // Reads ANTHROPIC_API_KEY. 3 min per attempt × 3 attempts stays below the 15-minute credit hold.
      client ??= new Anthropic({ timeout: 180_000, maxRetries: 2 });
      return client.beta.messages.create(params);
    });

  const base = (system: string) => ({
    model,
    max_tokens: MAX_TOKENS,
    betas: [FALLBACK_BETA],
    fallbacks: "default" as const,
    system: [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }],
    cache_control: { type: "ephemeral" as const }, // also caches the conversation so far for the next turn
  });
  const newUsage = (): AiUsage => ({ model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

  return {
    id: "anthropic",

    async generateSite(brief, locale) {
      const format = { type: "json_schema" as const, schema: GENERATED_SITE_JSON_SCHEMA };
      const domains = referenceDomains(brief);
      const tools: Anthropic.Beta.Messages.BetaToolUnion[] = domains.length
        ? [
            {
              type: "web_fetch_20260209",
              name: "web_fetch",
              allowed_domains: domains,
              max_uses: MAX_FETCHES,
              max_content_tokens: MAX_FETCH_TOKENS,
            },
          ]
        : [];
      const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
        { role: "user", content: generateUserMessage(brief, locale) },
      ];
      const usage = newUsage();

      for (let turn = 0; ; turn++) {
        const response = await create({
          ...base(GENERATE_SYSTEM_PROMPT),
          output_config: { effort: "medium", format },
          ...(tools.length ? { tools } : {}),
          messages,
        });
        addUsage(usage, response, model);
        if (response.stop_reason === "pause_turn" && turn < MAX_PAUSE_TURNS) {
          messages.push({ role: "assistant", content: response.content });
          continue;
        }
        assertUsable(response);
        const json = response.content.findLast((b) => b.type === "text");
        if (!json || json.type !== "text") throw new AiResponseError(`No site in response (${response.stop_reason})`);
        const site = generatedSiteSchema.parse(JSON.parse(json.text));
        return {
          output: { name: site.name, themeColor: site.themeColor, definition: { version: 1, blocks: site.blocks.map(withId) } },
          usage,
        };
      }
    },

    async editSite(site, request, locale) {
      const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
        { role: "user", content: editUserMessage(site, request, locale) },
      ];
      const usage = newUsage();
      const ops: PatchOp[] = [];
      let current = site;
      let summary = "";

      for (let turn = 0; turn < MAX_EDIT_TURNS; turn++) {
        const response = await create({
          ...base(EDIT_SYSTEM_PROMPT),
          output_config: { effort: "low" },
          tools: PATCH_TOOL_DEFINITIONS,
          messages,
        });
        addUsage(usage, response, model);
        assertUsable(response);
        summary = textOf(response) || summary;
        const calls = response.content.filter((b) => b.type === "tool_use");
        if (response.stop_reason !== "tool_use" || !calls.length) break;

        messages.push({ role: "assistant", content: response.content });
        const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = calls.map((call) => {
          try {
            const op = toPatchOp(call.name, call.input, current);
            current = applyPatches(current, [op]);
            ops.push(op);
            return { type: "tool_result", tool_use_id: call.id, content: describeOp(op) };
          } catch (e) {
            return { type: "tool_result", tool_use_id: call.id, content: errorText(e), is_error: true };
          }
        });
        messages.push({ role: "user", content: results }); // all results of one turn in one message
      }

      // If the turn limit is reached, the changes applied so far are kept.
      return { output: { ops, summary: (summary || FALLBACK_SUMMARY[locale]).slice(0, MAX_SUMMARY_LENGTH) }, usage };
    },
  };
}
