import "server-only";
import type { Locale } from "@/i18n/config";
import type { Block } from "@/lib/app-definition";
import { COLOR_WORDS, INSTRUCTION_WORDS, industryCopy, PALETTE, UI } from "./mock-content";
import type { PatchOp } from "./patches";
import type { AiProvider, AiUsage, EditRequest, Section, SiteBrief, SiteSnapshot, Tone } from "./types";

// Deterministic stand-in for a real model. It returns the same shapes (site JSON, patch ops,
// token usage) the Anthropic provider will return, so everything around it is production code.

const SIMULATED_MODEL = "claude-opus-5-5"; // simulated costs use this model's list prices
const SHARED_PROMPT_TOKENS = 4000; // system prompt + schema + examples, served from the prompt cache

const latency = () => Number(process.env.MOCK_AI_LATENCY_MS ?? 900);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 4);
const bid = () => Math.random().toString(36).slice(2, 10);

function usageFor(input: unknown, output: unknown, thinkingTokens: number): AiUsage {
  return {
    model: SIMULATED_MODEL,
    inputTokens: tokens(input) + 200,
    outputTokens: tokens(output) + thinkingTokens,
    cacheReadTokens: SHARED_PROMPT_TOKENS,
    cacheWriteTokens: 0,
  };
}

function generate(brief: SiteBrief, locale: Locale): SiteSnapshot {
  const c = industryCopy(locale)[brief.industry];
  const t = UI[locale];
  const services = brief.services
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const blocks: Block[] = [
    { id: bid(), type: "hero", title: brief.businessName, subtitle: c.tagline(brief) },
    {
      id: bid(),
      type: "text",
      heading: t.aboutHeading,
      body: (brief.tone === "friendly" ? t.friendlyPrefix : "") + c.about(brief),
    },
  ];
  if (services.length) {
    blocks.push({ id: bid(), type: "text", heading: c.servicesHeading, body: services.map((s) => `• ${s}`).join("\n") });
  }
  blocks.push({ id: bid(), type: "hours", title: t.hoursTitle, lines: c.hours });
  if (brief.phone) {
    blocks.push({ id: bid(), type: "button", label: t.callUs, href: `tel:${brief.phone.replace(/[^\d+]/g, "")}` });
  }
  blocks.push({ id: bid(), type: "contact", title: t.contactTitle, submitLabel: t.send });
  return { name: brief.businessName, themeColor: c.color, definition: { version: 1, blocks } };
}

function sectionBlock(section: Section, locale: Locale, site: SiteSnapshot): Block {
  const s = UI[locale].sections;
  switch (section) {
    case "prices":
    case "faq":
    case "team":
      return { id: bid(), type: "text", heading: s[section].heading, body: s[section].body };
    case "cta": {
      const phone = site.definition.blocks.find((b) => b.type === "button" && b.href.startsWith("tel:"));
      return { id: bid(), type: "button", label: s.cta.label, href: phone?.type === "button" ? phone.href : "#" };
    }
    case "gallery":
      return { id: bid(), type: "image", url: "", alt: s.gallery.alt };
  }
}

const sectionName = (section: Section, locale: Locale) => {
  const s = UI[locale].sections;
  return section === "cta" ? s.cta.label : section === "gallery" ? s.gallery.alt : s[section].heading;
};

function rewriteOps(site: SiteSnapshot, tone: Tone, locale: Locale): PatchOp[] {
  const prefix = UI[locale].friendlyPrefix;
  const ops: PatchOp[] = [];
  for (const b of site.definition.blocks) {
    if (b.type !== "text") continue;
    let body = b.body.startsWith(prefix) ? b.body.slice(prefix.length) : b.body;
    if (tone === "friendly") body = prefix + body;
    if (tone === "professional") body = body.replace(/!/g, ".");
    if (tone === "shorter") body = body.split("\n")[0].split(/(?<=[.!?])\s/)[0];
    if (body !== b.body) ops.push({ op: "update_block", id: b.id, fields: { body } });
  }
  return ops;
}

function redesignOps(site: SiteSnapshot, locale: Locale): PatchOp[] {
  const i = PALETTE.indexOf(site.themeColor.toLowerCase());
  const ops: PatchOp[] = [{ op: "set_theme", themeColor: PALETTE[(i + 1) % PALETTE.length] }];
  const hero = site.definition.blocks.find((b) => b.type === "hero");
  if (hero?.type === "hero") {
    const taglines = UI[locale].redesignTaglines;
    const next = taglines[(taglines.indexOf(hero.subtitle) + 1) % taglines.length];
    ops.push({ op: "update_block", id: hero.id, fields: { subtitle: next } });
  }
  const contact = site.definition.blocks.find((b) => b.type === "contact");
  if (contact) ops.push({ op: "move_block", id: contact.id, index: 1 });
  return ops;
}

function edit(site: SiteSnapshot, request: EditRequest, locale: Locale): { ops: PatchOp[]; summary: string } {
  const sum = UI[locale].summaries;
  switch (request.kind) {
    case "redesign":
      return { ops: redesignOps(site, locale), summary: sum.redesign };
    case "add_section":
      return {
        ops: [{ op: "add_block", block: sectionBlock(request.section, locale, site), index: Math.max(1, site.definition.blocks.length - 1) }],
        summary: sum.add_section(sectionName(request.section, locale)),
      };
    case "rewrite":
      return { ops: rewriteOps(site, request.tone, locale), summary: sum.rewrite[request.tone] };
    case "instruction": {
      const color = COLOR_WORDS.find(([re]) => re.test(request.text));
      if (color) return { ops: [{ op: "set_theme", themeColor: color[1] }], summary: sum.color };
      const match = INSTRUCTION_WORDS.find(([re]) => re.test(request.text));
      if (!match) return { ops: [], summary: sum.notUnderstood };
      const action = match[1];
      if (action === "redesign") return edit(site, { kind: "redesign" }, locale);
      if ("section" in action) return edit(site, { kind: "add_section", section: action.section }, locale);
      return edit(site, { kind: "rewrite", tone: action.tone }, locale);
    }
  }
}

export const mockProvider: AiProvider = {
  id: "mock",
  async generateSite(brief, locale) {
    await sleep(latency() * 2);
    const output = generate(brief, locale);
    return { output, usage: usageFor(brief, output, 1200) };
  },
  async editSite(site, request, locale) {
    await sleep(latency());
    const output = edit(site, request, locale);
    return { output, usage: usageFor({ site, request }, output, 400) };
  },
};
