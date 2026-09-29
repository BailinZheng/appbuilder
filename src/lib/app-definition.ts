import { z } from "zod";
import type { Locale } from "@/i18n/config";

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

export const BLOCK_TYPES: BlockType[] = ["hero", "text", "image", "button", "hours", "contact"];

// Starter content for new blocks, in the language the customer uses the platform in.
const STARTER = {
  de: {
    heroTitle: "Willkommen",
    heroSubtitle: "Ihr Slogan hier",
    textHeading: "Über uns",
    textBody: "Erzählen Sie Ihren Kunden, wer Sie sind.",
    buttonLabel: "Jetzt anrufen",
    hoursTitle: "Öffnungszeiten",
    hoursLines: "Mo–Fr: 9:00–18:00\nSa: 10:00–14:00",
    contactTitle: "Kontakt",
    contactSubmit: "Senden",
  },
  en: {
    heroTitle: "Welcome",
    heroSubtitle: "Your tagline here",
    textHeading: "About us",
    textBody: "Tell your customers who you are.",
    buttonLabel: "Call us",
    hoursTitle: "Opening hours",
    hoursLines: "Mon–Fri: 9:00–18:00\nSat: 10:00–14:00",
    contactTitle: "Contact us",
    contactSubmit: "Send",
  },
} satisfies Record<Locale, Record<string, string>>;

export function newBlock(type: BlockType, locale: Locale = "de"): Block {
  const bid = Math.random().toString(36).slice(2, 10);
  const s = STARTER[locale];
  switch (type) {
    case "hero":
      return { id: bid, type, title: s.heroTitle, subtitle: s.heroSubtitle };
    case "text":
      return { id: bid, type, heading: s.textHeading, body: s.textBody };
    case "image":
      return { id: bid, type, url: "", alt: "" };
    case "button":
      return { id: bid, type, label: s.buttonLabel, href: "tel:+49000000000" };
    case "hours":
      return { id: bid, type, title: s.hoursTitle, lines: s.hoursLines };
    case "contact":
      return { id: bid, type, title: s.contactTitle, submitLabel: s.contactSubmit };
  }
}

export function defaultDefinition(name: string, locale: Locale = "de"): AppDefinition {
  return {
    version: 1,
    blocks: [
      { ...newBlock("hero", locale), title: name } as Block,
      newBlock("text", locale),
      newBlock("hours", locale),
      newBlock("contact", locale),
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

const RESERVED = new Set(["www", "app", "api", "admin", "dashboard", "dev", "mail", "static", "assets", "s"]);

/** Checks a subdomain address. Returns an error key (translated by the caller) or null if valid. */
export function slugError(slug: string): "slugInvalid" | "slugReserved" | null {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) return "slugInvalid";
  if (RESERVED.has(slug)) return "slugReserved";
  return null;
}
