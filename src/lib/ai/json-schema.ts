import { z } from "zod";

// Zod → JSON schema for Claude's structured outputs and strict tools. The API supports a subset of
// JSON schema: every object must be closed (additionalProperties: false) and constraints such as
// maxLength, pattern or minimum are not enforced. Unsupported constraints are kept as a hint in the
// description; the Zod schema checks them again on our side. Unlike the SDK's helper this keeps
// `const` and `enum`, so the block type discriminator is enforced by the API itself.

const KEPT = new Set(["type", "description", "title", "enum", "const", "required", "$ref"]);
const FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

type Schema = Record<string, unknown>;

function strict(node: Schema): Schema {
  const out: Schema = {};
  const hints: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "$schema" || key === "additionalProperties") continue;
    if (KEPT.has(key)) out[key] = value;
    else if (key === "properties")
      out.properties = Object.fromEntries(Object.entries(value as Record<string, Schema>).map(([k, v]) => [k, strict(v)]));
    else if (key === "items") out.items = strict(value as Schema);
    else if (key === "anyOf" || key === "oneOf") out.anyOf = (value as Schema[]).map(strict);
    else if (key === "allOf") out.allOf = (value as Schema[]).map(strict);
    else if (key === "$defs")
      out.$defs = Object.fromEntries(Object.entries(value as Record<string, Schema>).map(([k, v]) => [k, strict(v)]));
    else if (key === "format" && FORMATS.has(value as string)) out.format = value;
    else if (key === "minItems" && (value === 0 || value === 1)) out.minItems = value;
    else hints.push(`${key}: ${JSON.stringify(value)}`);
  }
  if (out.type === "object") {
    out.properties ??= {};
    out.additionalProperties = false;
  }
  if (hints.length) out.description = [out.description, `{${hints.join(", ")}}`].filter(Boolean).join("\n\n");
  return out;
}

export function strictJsonSchema(schema: z.ZodType): Schema {
  return strict(z.toJSONSchema(schema) as Schema);
}
