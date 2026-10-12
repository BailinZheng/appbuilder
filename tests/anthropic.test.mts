// Claude provider tests with a scripted fake API – no network, no API key. Run with `npm test`.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { createAnthropicProvider, PATCH_TOOL_DEFINITIONS, referenceDomains, AiResponseError } = await import(
  "@/lib/ai/anthropic-provider"
);
const { applyPatches } = await import("@/lib/ai/patches");
const { siteBriefSchema } = await import("@/lib/ai/types");
const { GENERATE_SYSTEM_PROMPT, EDIT_SYSTEM_PROMPT } = await import("@/lib/ai/anthropic-prompts");

type Params = Parameters<NonNullable<Parameters<typeof createAnthropicProvider>[0]>["create"] & {}>[0];

const site = {
  name: "Bäckerei Sonne",
  themeColor: "#b45309",
  definition: {
    version: 1 as const,
    blocks: [
      { id: "h1", type: "hero" as const, title: "Bäckerei Sonne", subtitle: "Frisch seit dem Morgen" },
      { id: "t1", type: "text" as const, heading: "Über uns", body: "Wir backen jeden Tag." },
      { id: "c1", type: "contact" as const, title: "Kontakt", submitLabel: "Senden" },
    ],
  },
};

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
});

let seq = 0;
const toolUse = (name: string, input: unknown) => ({ type: "tool_use", id: `tu_${++seq}`, name, input });

/** A fake `messages.create` that returns the scripted responses in order and records every request. */
function scripted(responses: object[]) {
  const requests: Params[] = [];
  const create = async (params: Params) => {
    requests.push(JSON.parse(JSON.stringify(params))); // what goes over the wire
    const next = responses.shift();
    if (!next) throw new Error("No scripted response left");
    return { id: `msg_${requests.length}`, type: "message", role: "assistant", model: "claude-opus-5-5", stop_details: null, ...next } as never;
  };
  return { create, requests };
}

function allObjectsStrict(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.every(allObjectsStrict);
  if (!schema || typeof schema !== "object") return true;
  const s = schema as Record<string, unknown>;
  if (s.type === "object" && s.additionalProperties !== false) return false;
  return Object.values(s).every(allObjectsStrict);
}

describe("Claude provider: schemas and prompts", () => {
  test("patch tools are strict, closed and cover every patch op", () => {
    assert.deepEqual(
      PATCH_TOOL_DEFINITIONS.map((t) => t.name).sort(),
      ["add_block", "move_block", "remove_block", "set_name", "set_theme", "update_block"],
    );
    for (const tool of PATCH_TOOL_DEFINITIONS) {
      assert.equal(tool.strict, true, tool.name);
      assert.ok(allObjectsStrict(tool.input_schema), `${tool.name} has an open object`);
      assert.doesNotMatch(JSON.stringify(tool.input_schema), /"maxLength"|"pattern"|"minimum"/, tool.name);
    }
    // The block type discriminator is enforced by the API (const), not just described.
    const addBlock = JSON.stringify(PATCH_TOOL_DEFINITIONS.find((t) => t.name === "add_block"));
    for (const type of ["hero", "text", "image", "button", "hours", "contact"]) assert.match(addBlock, new RegExp(`"const":"${type}"`));
  });

  test("system prompts are frozen strings that can be cached", () => {
    for (const prompt of [GENERATE_SYSTEM_PROMPT, EDIT_SYSTEM_PROMPT]) {
      assert.doesNotMatch(prompt, /\$\{|undefined|\d{4}-\d{2}-\d{2}/);
      assert.ok(prompt.length > 2500, "long enough to reach the minimum cacheable prefix");
    }
  });

  test("web fetch is limited to the customer's reference domains", () => {
    const brief = siteBriefSchema.parse({
      businessName: "Bäckerei Sonne",
      industry: "bakery",
      city: "Berlin",
      services: "",
      tone: "friendly",
      phone: "",
      existingSiteUrl: "www.baeckerei-sonne.de/start",
      inspirationUrl: "https://shop.example.com",
    });
    assert.deepEqual(referenceDomains(brief), ["baeckerei-sonne.de", "shop.example.com"]);
    assert.deepEqual(referenceDomains({ ...brief, existingSiteUrl: "", inspirationUrl: "" }), []);
  });
});

describe("Claude provider: editSite", () => {
  test("applies strict tool calls, feeds errors back and sums usage", async () => {
    const api = scripted([
      {
        stop_reason: "tool_use",
        content: [
          toolUse("update_block", { id: "h1", fields: { heading: "Falsches Feld" } }), // hero has no heading
          toolUse("set_theme", { themeColor: "#1d4ed8" }),
          toolUse("add_block", { block: { type: "text", heading: "FAQ", body: "Haben Sie glutenfreies Brot? Ja." }, index: 2 }),
        ],
        usage: usage(1200, 300, 0, 2000),
      },
      {
        stop_reason: "tool_use",
        content: [toolUse("update_block", { id: "h1", fields: { subtitle: "Jeden Morgen frisch" } })],
        usage: usage(300, 80, 2000, 400),
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Neue Farbe, FAQ ergänzt und Slogan aufgefrischt." }], usage: usage(200, 40, 2400, 0) },
    ]);
    const ai = createAnthropicProvider({ create: api.create, model: "claude-opus-5-5" });
    const { output, usage: total } = await ai.editSite(site, { kind: "instruction", text: "Mach es blau und füge ein FAQ hinzu" }, "de");

    assert.deepEqual(output.ops.map((o) => o.op), ["set_theme", "add_block", "update_block"]);
    assert.equal(output.summary, "Neue Farbe, FAQ ergänzt und Slogan aufgefrischt.");
    assert.deepEqual(total, { model: "claude-opus-5-5", inputTokens: 1700, outputTokens: 420, cacheReadTokens: 4400, cacheWriteTokens: 2400 });

    // The returned ops reproduce the result when applied to the original site (that is what the action does).
    const result = applyPatches(site, output.ops);
    assert.equal(result.themeColor, "#1d4ed8");
    assert.deepEqual(result.definition.blocks.map((b) => b.type), ["hero", "text", "text", "contact"]);
    assert.equal(result.definition.blocks[0].type === "hero" && result.definition.blocks[0].subtitle, "Jeden Morgen frisch");
    assert.match(result.definition.blocks[2].id, /^[a-z0-9]+$/, "block ids are assigned by us");

    // Request shape: strict tools, cached system prompt, automatic conversation caching, fallback opt-in.
    const [first, second] = api.requests;
    assert.equal(first.tools?.length, 6);
    assert.deepEqual(first.system, [{ type: "text", text: EDIT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
    assert.deepEqual(first.cache_control, { type: "ephemeral" });
    assert.equal(first.fallbacks, "default");
    assert.ok(first.betas?.includes("server-side-fallback-2026-07-01"));
    assert.equal(first.tool_choice, undefined, "forced tool use is rejected by Opus 5.5");

    // All three results of the first turn come back in one user message; the wrong field is an error.
    const results = second.messages[2].content as { is_error?: boolean; content: string }[];
    assert.equal(results.length, 3);
    assert.equal(results[0].is_error, true);
    assert.match(results[0].content, /no field heading/);
    assert.match(results[2].content, /Added text block with id \w+/);
  });

  test("an empty answer changes nothing and keeps the model's explanation", async () => {
    const api = scripted([
      { stop_reason: "end_turn", content: [{ type: "text", text: "Online-Buchungen sind leider nicht möglich." }], usage: usage(900, 60) },
    ]);
    const ai = createAnthropicProvider({ create: api.create, model: "claude-opus-5-5" });
    const { output } = await ai.editSite(site, { kind: "instruction", text: "Füge Online-Buchung hinzu" }, "de");
    assert.deepEqual(output.ops, []);
    assert.match(output.summary, /nicht möglich/);
  });

  test("refusals and truncated answers are errors (so the credits are released)", async () => {
    for (const stop_reason of ["refusal", "max_tokens"]) {
      const api = scripted([{ stop_reason, content: [toolUse("set_theme", { themeColor: "#000000" })], usage: usage(10, 10) }]);
      const ai = createAnthropicProvider({ create: api.create, model: "claude-opus-5-5" });
      await assert.rejects(ai.editSite(site, { kind: "redesign" }, "de"), AiResponseError);
    }
  });
});

describe("Claude provider: generateSite", () => {
  const brief = siteBriefSchema.parse({
    businessName: "Salon Lena",
    industry: "hairdresser",
    city: "Köln",
    services: "Schneiden, Färben",
    tone: "friendly",
    phone: "0221 123456",
    existingSiteUrl: "salon-lena.de",
    inspirationUrl: "",
  });
  const generated = {
    name: "Salon Lena",
    themeColor: "#9d174d",
    blocks: [
      { type: "hero", title: "Salon Lena", subtitle: "Ihr Friseur in Köln" },
      { type: "text", heading: "Leistungen", body: "• Schneiden\n• Färben" },
      { type: "button", label: "Jetzt anrufen", href: "tel:0221123456" },
      { type: "contact", title: "Kontakt", submitLabel: "Senden" },
    ],
  };

  test("uses structured output, resumes paused web fetches and assigns block ids", async () => {
    const api = scripted([
      { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "srv_1", name: "web_fetch", input: { url: "https://salon-lena.de/" } }], usage: usage(3000, 200) },
      { stop_reason: "end_turn", model: "claude-opus-5", content: [{ type: "text", text: JSON.stringify(generated) }], usage: usage(500, 900, 3000) },
    ]);
    const ai = createAnthropicProvider({ create: api.create, model: "claude-opus-5-5" });
    const { output, usage: total } = await ai.generateSite(brief, "de");

    const ids = output.definition.blocks.map((b) => b.id);
    assert.equal(new Set(ids).size, 4);
    assert.doesNotThrow(() => applyPatches(output, []), "result is a valid site");
    assert.equal(output.themeColor, "#9d174d");
    assert.equal(total.model, "claude-opus-5", "billed at the fallback model's price");
    assert.equal(total.inputTokens, 3500);

    const [first, second] = api.requests;
    assert.equal(first.output_config?.format?.type, "json_schema");
    assert.ok(allObjectsStrict(first.output_config?.format?.schema));
    assert.match(JSON.stringify(first.output_config?.format?.schema), /"const":"contact"/);
    assert.deepEqual(first.tools, [
      { type: "web_fetch_20260209", name: "web_fetch", allowed_domains: ["salon-lena.de"], max_uses: 4, max_content_tokens: 15000 },
    ]);
    assert.equal(second.messages.length, 2, "paused turn is sent back to continue");
    assert.match(String(first.messages[0].content), /Site language: German/);
  });

  test("no reference URLs → no web fetch tool", async () => {
    const api = scripted([{ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(generated) }], usage: usage(800, 900) }]);
    const ai = createAnthropicProvider({ create: api.create, model: "claude-opus-5-5" });
    await ai.generateSite({ ...brief, existingSiteUrl: "" }, "en");
    assert.equal(api.requests[0].tools, undefined);
  });

  test("output that breaks the site rules is rejected", async () => {
    const bad = { ...generated, blocks: [{ type: "button", label: "Klick", href: "javascript:alert(1)" }] };
    const api = scripted([{ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(bad) }], usage: usage(800, 100) }]);
    const ai = createAnthropicProvider({ create: api.create, model: "claude-opus-5-5" });
    await assert.rejects(ai.generateSite(brief, "de"), /Invalid link|javascript/i);
  });

  test("only supported models can be configured", () => {
    assert.throws(() => createAnthropicProvider({ model: "claude-haiku-4-5" }), /Unsupported/);
  });
});
