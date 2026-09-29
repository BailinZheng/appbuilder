import { z } from "zod";

// The "no-code" core: every customer app is just this JSON document.
// One shared renderer turns it into a website/PWA at runtime.

const id = z.string().min(1).max(40);
const short = z.string().max(200);
const long = z.string().max(5000);
// Only allow http(s), mailto, tel and relative links – blocks `javascript:` URLs (XSS).
const safeUrl = z
  .string()
  .max(1000)
  .refine((v) => v === "" || /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(v), "Invalid link");

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("hero"), title: short, subtitle: short }),
  z.object({ id, type: z.literal("text"), heading: short, body: long }),
  z.object({ id, type: z.literal("image"), url: safeUrl, alt: short }),
  z.object({ id, type: z.literal("button"), label: short, href: safeUrl }),
  z.object({ id, type: z.literal("hours"), title: short, lines: long }),
  z.object({ id, type: z.literal("contact"), title: short, submitLabel: short }),
]);

export const appDefinitionSchema = z.object({
  version: z.literal(1),
  blocks: z.array(blockSchema).max(100),
});

export const legalSchema = z.object({
  businessName: short,
  owner: short,
  address: z.string().max(500),
  email: z.string().max(200),
  phone: short,
  vatId: short,
});

export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block["type"];
export type AppDefinition = z.infer<typeof appDefinitionSchema>;
export type LegalInfo = z.infer<typeof legalSchema>;

export const BLOCK_LABELS: Record<BlockType, string> = {
  hero: "Header",
  text: "Text",
  image: "Image",
  button: "Button / Link",
  hours: "Opening hours",
  contact: "Contact form",
};

export function newBlock(type: BlockType): Block {
  const bid = Math.random().toString(36).slice(2, 10);
  switch (type) {
    case "hero":
      return { id: bid, type, title: "Welcome", subtitle: "Your tagline here" };
    case "text":
      return { id: bid, type, heading: "About us", body: "Tell your customers who you are." };
    case "image":
      return { id: bid, type, url: "", alt: "" };
    case "button":
      return { id: bid, type, label: "Call us", href: "tel:+49000000000" };
    case "hours":
      return { id: bid, type, title: "Opening hours", lines: "Mon–Fri: 9:00–18:00\nSat: 10:00–14:00" };
    case "contact":
      return { id: bid, type, title: "Contact us", submitLabel: "Send" };
  }
}

export function defaultDefinition(name: string): AppDefinition {
  return {
    version: 1,
    blocks: [
      { ...newBlock("hero"), title: name } as Block,
      newBlock("text"),
      newBlock("hours"),
      newBlock("contact"),
    ],
  };
}

export const emptyLegal: LegalInfo = {
  businessName: "",
  owner: "",
  address: "",
  email: "",
  phone: "",
  vatId: "",
};

/** Impressum (§5 DDG) minimum: name, address, e-mail. Required before publishing. */
export function legalComplete(l: LegalInfo) {
  return Boolean(l.businessName.trim() && l.owner.trim() && l.address.trim() && l.email.trim());
}

const RESERVED = new Set(["www", "app", "api", "admin", "dashboard", "mail", "static", "assets", "s"]);
export const slugSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "3–40 chars: a–z, 0–9 and dashes")
  .refine((s) => !RESERVED.has(s), "This name is reserved");
