import type { Locale } from "@/i18n/config";
import type { Industry, Section, SiteBrief, Tone } from "./types";

// Canned copy for the mock AI provider. Good enough for demos; the real provider replaces all of it.

type IndustryCopy = {
  color: string;
  tagline: (b: SiteBrief) => string;
  about: (b: SiteBrief) => string;
  hours: string;
  servicesHeading: string;
};

const where = (b: SiteBrief, word: string) => (b.city ? ` ${word} ${b.city}` : "");

const DE: Record<Industry, IndustryCopy> = {
  bakery: {
    color: "#b45309",
    tagline: (b) => `Jeden Morgen frisch gebacken${where(b, "in")}`,
    about: (b) => `Bei ${b.businessName} backen wir nach traditionellen Rezepten – mit regionalen Zutaten und viel Liebe zum Handwerk.`,
    hours: "Mo–Fr: 6:30–18:00\nSa: 7:00–13:00\nSo: 8:00–11:00",
    servicesHeading: "Unser Sortiment",
  },
  hairdresser: {
    color: "#be185d",
    tagline: (b) => `Ihr Friseur für moderne Schnitte${where(b, "in")}`,
    about: (b) => `${b.businessName} steht für typgerechte Beratung, präzise Schnitte und eine Wohlfühl-Atmosphäre.`,
    hours: "Di–Fr: 9:00–18:30\nSa: 8:00–14:00",
    servicesHeading: "Unsere Leistungen",
  },
  restaurant: {
    color: "#15803d",
    tagline: (b) => `Genuss mit Herz${where(b, "in")}`,
    about: (b) => `Bei ${b.businessName} kochen wir mit frischen, saisonalen Zutaten – für Gäste, die gutes Essen schätzen.`,
    hours: "Mo–Sa: 11:30–22:00\nSo: 11:30–15:00",
    servicesHeading: "Unsere Küche",
  },
  craftsman: {
    color: "#1d4ed8",
    tagline: (b) => `Zuverlässiges Handwerk${where(b, "aus")}`,
    about: (b) => `${b.businessName} ist Ihr Meisterbetrieb für saubere Arbeit, faire Preise und pünktliche Termine.`,
    hours: "Mo–Fr: 7:00–17:00\nNotdienst nach Vereinbarung",
    servicesHeading: "Unsere Leistungen",
  },
  fitness: {
    color: "#7c3aed",
    tagline: (b) => `Stärker werden – Schritt für Schritt${where(b, "in")}`,
    about: (b) => `${b.businessName} begleitet Sie mit persönlichem Training und Plänen, die zu Ihrem Alltag passen.`,
    hours: "Mo–Fr: 7:00–21:00\nSa: 9:00–15:00",
    servicesHeading: "Unsere Angebote",
  },
  other: {
    color: "#0f766e",
    tagline: (b) => `Ihr Partner vor Ort${where(b, "in")}`,
    about: (b) => `${b.businessName} steht für persönliche Beratung und Qualität, auf die Sie sich verlassen können.`,
    hours: "Mo–Fr: 9:00–18:00",
    servicesHeading: "Unsere Leistungen",
  },
};

const EN: Record<Industry, IndustryCopy> = {
  bakery: {
    color: "#b45309",
    tagline: (b) => `Freshly baked every morning${where(b, "in")}`,
    about: (b) => `At ${b.businessName} we bake with traditional recipes, regional ingredients and real craftsmanship.`,
    hours: "Mon–Fri: 6:30–18:00\nSat: 7:00–13:00\nSun: 8:00–11:00",
    servicesHeading: "Our selection",
  },
  hairdresser: {
    color: "#be185d",
    tagline: (b) => `Modern haircuts${where(b, "in")}`,
    about: (b) => `${b.businessName} stands for personal advice, precise cuts and a place to feel good.`,
    hours: "Tue–Fri: 9:00–18:30\nSat: 8:00–14:00",
    servicesHeading: "Our services",
  },
  restaurant: {
    color: "#15803d",
    tagline: (b) => `Food made with heart${where(b, "in")}`,
    about: (b) => `At ${b.businessName} we cook with fresh, seasonal ingredients for guests who love good food.`,
    hours: "Mon–Sat: 11:30–22:00\nSun: 11:30–15:00",
    servicesHeading: "Our kitchen",
  },
  craftsman: {
    color: "#1d4ed8",
    tagline: (b) => `Reliable craftsmanship${where(b, "from")}`,
    about: (b) => `${b.businessName} is your master business for clean work, fair prices and punctual appointments.`,
    hours: "Mon–Fri: 7:00–17:00\nEmergency service by arrangement",
    servicesHeading: "Our services",
  },
  fitness: {
    color: "#7c3aed",
    tagline: (b) => `Get stronger, step by step${where(b, "in")}`,
    about: (b) => `${b.businessName} supports you with personal training and plans that fit your everyday life.`,
    hours: "Mon–Fri: 7:00–21:00\nSat: 9:00–15:00",
    servicesHeading: "What we offer",
  },
  other: {
    color: "#0f766e",
    tagline: (b) => `Your local partner${where(b, "in")}`,
    about: (b) => `${b.businessName} stands for personal service and quality you can rely on.`,
    hours: "Mon–Fri: 9:00–18:00",
    servicesHeading: "Our services",
  },
};

export const industryCopy = (locale: Locale) => (locale === "de" ? DE : EN);

export const UI = {
  de: {
    aboutHeading: "Über uns",
    hoursTitle: "Öffnungszeiten",
    contactTitle: "Kontakt",
    send: "Senden",
    callUs: "Jetzt anrufen",
    friendlyPrefix: "Schön, dass Sie da sind! ",
    redesignTaglines: ["Qualität, die man spürt", "Mit Leidenschaft für Sie da", "Persönlich. Ehrlich. Nah."],
    sections: {
      prices: { heading: "Preise", body: "Leistung A – ab 25 €\nLeistung B – ab 45 €\nLeistung C – auf Anfrage" },
      faq: { heading: "Häufige Fragen", body: "Muss ich einen Termin vereinbaren?\nNicht zwingend – mit Termin geht es aber schneller.\n\nWie kann ich bezahlen?\nBar, mit Karte oder per Überweisung." },
      team: { heading: "Unser Team", body: "Ein eingespieltes Team mit langjähriger Erfahrung – wir freuen uns auf Sie!" },
      cta: { label: "Jetzt Termin vereinbaren" },
      gallery: { alt: "Einblick in unseren Betrieb" },
    },
    summaries: {
      redesign: "Neues Farbschema und frischer Slogan – der Kontaktbereich steht jetzt weiter oben.",
      add_section: (name: string) => `Bereich „${name}“ hinzugefügt.`,
      rewrite: { friendly: "Texte freundlicher formuliert.", professional: "Texte sachlicher formuliert.", shorter: "Texte gekürzt." },
      color: "Farbe geändert.",
      notUnderstood: "Die Demo-KI hat die Anweisung nicht verstanden. Probieren Sie z. B. „blau“, „Preisliste“, „kürzer“ oder „modernes Design“.",
    },
  },
  en: {
    aboutHeading: "About us",
    hoursTitle: "Opening hours",
    contactTitle: "Contact us",
    send: "Send",
    callUs: "Call us",
    friendlyPrefix: "So glad you're here! ",
    redesignTaglines: ["Quality you can feel", "Here for you, with passion", "Personal. Honest. Local."],
    sections: {
      prices: { heading: "Prices", body: "Service A – from €25\nService B – from €45\nService C – on request" },
      faq: { heading: "FAQ", body: "Do I need an appointment?\nNot necessarily – but it's faster with one.\n\nHow can I pay?\nCash, card or bank transfer." },
      team: { heading: "Our team", body: "A well-rehearsed team with years of experience – we look forward to meeting you!" },
      cta: { label: "Book an appointment" },
      gallery: { alt: "A look inside our business" },
    },
    summaries: {
      redesign: "New colour scheme and a fresh tagline – the contact section is now further up.",
      add_section: (name: string) => `Added the "${name}" section.`,
      rewrite: { friendly: "Made the texts friendlier.", professional: "Made the texts more professional.", shorter: "Shortened the texts." },
      color: "Changed the colour.",
      notUnderstood: "The demo AI didn't understand that instruction. Try e.g. \"blue\", \"price list\", \"shorter\" or \"modern design\".",
    },
  },
} satisfies Record<Locale, unknown>;

/** Brand colours the mock "borrows" from well-known inspiration sites. */
export const BRAND_COLORS: Record<string, string> = {
  "youtube.com": "#dc2626",
  "google.com": "#1a73e8",
  "google.de": "#1a73e8",
  "microsoft.com": "#0067b8",
  "apple.com": "#111827",
  "amazon.com": "#ea580c",
  "amazon.de": "#ea580c",
  "spotify.com": "#15803d",
  "airbnb.com": "#e11d48",
  "facebook.com": "#1877f2",
  "instagram.com": "#c13584",
  "netflix.com": "#b91c1c",
  "linkedin.com": "#0a66c2",
};

export const PALETTE = ["#2563eb", "#b45309", "#be185d", "#15803d", "#7c3aed", "#0f766e", "#dc2626", "#111827"];

/** Keyword → colour for free-form instructions (German and English). */
export const COLOR_WORDS: [RegExp, string][] = [
  [/\b(blau|blue)\b/i, "#2563eb"],
  [/\b(rot|red)\b/i, "#dc2626"],
  [/\b(grün|gruen|green)\b/i, "#15803d"],
  [/\b(lila|violett|purple)\b/i, "#7c3aed"],
  [/\b(orange)\b/i, "#ea580c"],
  [/\b(schwarz|black|dunkel|dark)\b/i, "#111827"],
  [/\b(rosa|pink)\b/i, "#db2777"],
];

/** Keyword → action for free-form instructions. Checked in order. */
export const INSTRUCTION_WORDS: [RegExp, { section: Section } | { tone: Tone } | "redesign"][] = [
  [/(preis|price)/i, { section: "prices" }],
  [/(faq|fragen|questions)/i, { section: "faq" }],
  [/(team|mitarbeiter|staff)/i, { section: "team" }],
  [/(termin|appointment|booking|buchen)/i, { section: "cta" }],
  [/(galerie|gallery|bild|photo|foto)/i, { section: "gallery" }],
  [/(kürzer|kuerzer|kurz|shorter|short)/i, { tone: "shorter" }],
  [/(freundlich|friendly|warm)/i, { tone: "friendly" }],
  [/(professionell|seriös|serioes|professional|formal)/i, { tone: "professional" }],
  [/(modern|redesign|neu gestalten|frisch|fresh)/i, "redesign"],
];
