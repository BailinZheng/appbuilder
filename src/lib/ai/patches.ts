import { z } from "zod";
import { appDefinitionSchema, blockSchema, type Block } from "@/lib/app-definition";
import type { SiteSnapshot } from "./types";

// AI edits are returned as small patch operations instead of a whole new site.
// This keeps AI output (the expensive part) small and every change reviewable.
// The same schema will be given to Claude as strict tool definitions.

export const patchOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_block"), block: blockSchema, index: z.number().int().min(0).optional() }),
  z.object({ op: z.literal("update_block"), id: z.string(), fields: z.record(z.string(), z.string()) }),
  z.object({ op: z.literal("remove_block"), id: z.string() }),
  z.object({ op: z.literal("move_block"), id: z.string(), index: z.number().int().min(0) }),
  z.object({ op: z.literal("set_theme"), themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ op: z.literal("set_name"), name: z.string().trim().min(2).max(80) }),
]);
export type PatchOp = z.infer<typeof patchOpSchema>;

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchError";
  }
}

/** Applies ops to a copy of the site and validates the result. Throws PatchError on anything invalid. */
export function applyPatches(site: SiteSnapshot, rawOps: unknown[]): SiteSnapshot {
  const ops = z.array(patchOpSchema).max(50).parse(rawOps);
  let { name, themeColor } = site;
  const blocks: Block[] = site.definition.blocks.map((b) => ({ ...b }));
  const indexOf = (id: string) => {
    const i = blocks.findIndex((b) => b.id === id);
    if (i < 0) throw new PatchError(`Unknown block ${id}`);
    return i;
  };

  for (const op of ops) {
    switch (op.op) {
      case "add_block":
        if (blocks.some((b) => b.id === op.block.id)) throw new PatchError(`Duplicate block id ${op.block.id}`);
        blocks.splice(Math.min(op.index ?? blocks.length, blocks.length), 0, op.block);
        break;
      case "update_block": {
        const i = indexOf(op.id);
        const fields = Object.fromEntries(Object.entries(op.fields).filter(([k]) => k !== "id" && k !== "type"));
        blocks[i] = { ...blocks[i], ...fields } as Block; // id and type can never be changed
        break;
      }
      case "remove_block":
        blocks.splice(indexOf(op.id), 1);
        break;
      case "move_block": {
        const [b] = blocks.splice(indexOf(op.id), 1);
        blocks.splice(Math.min(op.index, blocks.length), 0, b);
        break;
      }
      case "set_theme":
        themeColor = op.themeColor;
        break;
      case "set_name":
        name = op.name;
        break;
    }
  }

  const definition = appDefinitionSchema.safeParse({ ...site.definition, blocks });
  if (!definition.success) throw new PatchError(definition.error.issues[0]?.message ?? "Invalid result");
  return { name, themeColor, definition: definition.data };
}
