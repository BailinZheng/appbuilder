"use server";

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { getLocale } from "@/i18n/server";
import { creditsForMeteredUsage, costMicroUsd } from "@/lib/ai/pricing";
import { getAiProvider } from "@/lib/ai/provider";
import { applyPatches } from "@/lib/ai/patches";
import { SECTIONS, siteBriefSchema, TONES, type EditRequest, type SiteSnapshot } from "@/lib/ai/types";
import { emptyLegal, slugError } from "@/lib/app-definition";
import { requireUser } from "@/lib/auth";
import { runBilledAction } from "@/lib/billing/billed-action";
import { ACTION_PRICES, METERED_INSTRUCTION, type BilledAction } from "@/lib/billing/catalog";
import { getBalance, InsufficientCreditsError } from "@/lib/billing/ledger";

// Error codes are returned (not texts) so the client shows them in the current language.
export type AiError =
  | { code: "insufficient"; required: number; available: number }
  | { code: "invalidBrief" | "slugInvalid" | "slugReserved" | "slugTaken" | "notFound" | "failed" };

function toAiError(e: unknown): AiError {
  if (e instanceof InsufficientCreditsError) return { code: "insufficient", required: e.required, available: e.available };
  console.error("[ai] action failed", e);
  return { code: "failed" };
}

// ---------------------------------------------------------------------------
// Create a whole website from the guided form
// ---------------------------------------------------------------------------

export type GenerateState = { error?: AiError };

export async function generateSiteAction(_prev: GenerateState, formData: FormData): Promise<GenerateState> {
  const user = await requireUser();
  const locale = await getLocale();
  const brief = siteBriefSchema.safeParse(Object.fromEntries(formData));
  if (!brief.success) return { error: { code: "invalidBrief" } };

  const slug = String(formData.get("slug") ?? "").toLowerCase();
  const slugProblem = slugError(slug);
  if (slugProblem) return { error: { code: slugProblem } };
  const [taken] = await db.select({ id: schema.apps.id }).from(schema.apps).where(eq(schema.apps.slug, slug));
  if (taken) return { error: { code: "slugTaken" } };

  const ai = getAiProvider();
  const appId = nanoid();
  try {
    await runBilledAction({
      userId: user.id,
      action: "generate_site",
      reserve: ACTION_PRICES.generate_site,
      provider: ai.id,
      compute: async () => {
        const { output, usage } = await ai.generateSite(brief.data, locale);
        applyPatches(output, []); // validates the generated site before anyone pays for it
        return { output, usage, charge: ACTION_PRICES.generate_site };
      },
      commit: async (tx, site) => {
        await tx.insert(schema.apps).values({
          id: appId,
          ownerId: user.id,
          slug,
          name: site.name,
          themeColor: site.themeColor,
          definition: site.definition,
          legal: { ...emptyLegal, businessName: site.name, owner: user.name, email: user.email, phone: brief.data.phone },
        });
      },
    });
  } catch (e) {
    return { error: toAiError(e) };
  }
  revalidatePath("/dashboard", "layout"); // header balance
  redirect(`/dashboard/apps/${appId}`);
}

// ---------------------------------------------------------------------------
// AI edits on an existing app
// ---------------------------------------------------------------------------

const editRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("redesign") }),
  z.object({ kind: z.literal("add_section"), section: z.enum(SECTIONS) }),
  z.object({ kind: z.literal("rewrite"), tone: z.enum(TONES) }),
  z.object({ kind: z.literal("instruction"), text: z.string().trim().min(2).max(500) }),
]);

export type EditResult =
  | { ok: true; site: SiteSnapshot; summary: string; charged: number; balance: number; canUndo: boolean }
  | { ok: false; error: AiError };

async function loadOwnedApp(userId: string, appId: string) {
  const [app] = await db
    .select()
    .from(schema.apps)
    .where(and(eq(schema.apps.id, appId), eq(schema.apps.ownerId, userId)));
  return app;
}

export async function aiEditAction(appId: string, rawRequest: EditRequest): Promise<EditResult> {
  const user = await requireUser();
  const locale = await getLocale();
  const parsed = editRequestSchema.safeParse(rawRequest);
  if (!parsed.success) return { ok: false, error: { code: "failed" } };
  const request = parsed.data;
  const app = await loadOwnedApp(user.id, appId);
  if (!app) return { ok: false, error: { code: "notFound" } };

  const action: BilledAction = request.kind;
  const metered = action === "instruction";
  const reserve = metered ? METERED_INSTRUCTION.max : ACTION_PRICES[action];
  const before: SiteSnapshot = { name: app.name, themeColor: app.themeColor, definition: app.definition };
  const ai = getAiProvider();

  try {
    const { output, charged } = await runBilledAction({
      userId: user.id,
      appId,
      action,
      reserve,
      provider: ai.id,
      compute: async () => {
        const { output, usage } = await ai.editSite(before, request, locale);
        const site = applyPatches(before, output.ops);
        const changed = output.ops.length > 0;
        const charge = !changed ? 0 : metered ? creditsForMeteredUsage(costMicroUsd(usage)) : reserve;
        return { output: { site, summary: output.summary }, usage, charge };
      },
      commit: async (tx, { site }) => {
        // Snapshot the old version first – this is what "undo" restores, for free.
        await tx.insert(schema.appVersions).values({ id: nanoid(), appId, reason: action, ...before });
        await tx
          .update(schema.apps)
          .set({ name: site.name, themeColor: site.themeColor, definition: site.definition, updatedAt: new Date() })
          .where(eq(schema.apps.id, appId));
      },
    });
    revalidatePath(`/s/${app.slug}`, "layout");
    if (charged > 0) revalidatePath("/dashboard", "layout"); // header balance
    return {
      ok: true,
      site: charged > 0 ? output.site : before,
      summary: output.summary,
      charged,
      balance: await getBalance(user.id),
      canUndo: await hasVersions(appId),
    };
  } catch (e) {
    return { ok: false, error: toAiError(e) };
  }
}

async function hasVersions(appId: string) {
  const [v] = await db
    .select({ id: schema.appVersions.id })
    .from(schema.appVersions)
    .where(eq(schema.appVersions.appId, appId))
    .limit(1);
  return Boolean(v);
}

/** Restores the snapshot taken before the last AI change. Always free. */
export async function undoAiChangeAction(appId: string): Promise<EditResult> {
  const user = await requireUser();
  const app = await loadOwnedApp(user.id, appId);
  if (!app) return { ok: false, error: { code: "notFound" } };

  const site = await db.transaction(async (tx) => {
    const [last] = await tx
      .select()
      .from(schema.appVersions)
      .where(eq(schema.appVersions.appId, appId))
      .orderBy(desc(schema.appVersions.createdAt))
      .limit(1)
      .for("update");
    if (!last) return null;
    await tx
      .update(schema.apps)
      .set({ name: last.name, themeColor: last.themeColor, definition: last.definition, updatedAt: new Date() })
      .where(eq(schema.apps.id, appId));
    await tx.delete(schema.appVersions).where(eq(schema.appVersions.id, last.id));
    return { name: last.name, themeColor: last.themeColor, definition: last.definition };
  });
  if (!site) return { ok: false, error: { code: "notFound" } };

  revalidatePath(`/s/${app.slug}`, "layout");
  return { ok: true, site, summary: "", charged: 0, balance: await getBalance(user.id), canUndo: await hasVersions(appId) };
}
