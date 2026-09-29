"use server";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { auth, requireUser } from "@/lib/auth";
import { headers } from "next/headers";
import {
  appDefinitionSchema,
  defaultDefinition,
  emptyLegal,
  legalComplete,
  legalSchema,
  slugSchema,
} from "@/lib/app-definition";

// Every action re-checks the logged-in user and filters by ownerId (tenant isolation).
const own = (userId: string, appId: string) =>
  and(eq(schema.apps.id, appId), eq(schema.apps.ownerId, userId));

export type CreateState = { error?: string };

export async function createApp(_prev: CreateState, formData: FormData): Promise<CreateState> {
  const user = await requireUser();
  const parsed = z
    .object({ name: z.string().trim().min(2).max(80), slug: slugSchema })
    .safeParse({ name: formData.get("name"), slug: String(formData.get("slug") ?? "").toLowerCase() });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { name, slug } = parsed.data;
  const [taken] = await db.select({ id: schema.apps.id }).from(schema.apps).where(eq(schema.apps.slug, slug));
  if (taken) return { error: "This address is already taken." };

  const id = nanoid();
  await db.insert(schema.apps).values({
    id,
    ownerId: user.id,
    slug,
    name,
    definition: defaultDefinition(name),
    legal: { ...emptyLegal, owner: user.name, email: user.email },
  });
  redirect(`/dashboard/apps/${id}`);
}

const saveSchema = z.object({
  name: z.string().trim().min(2).max(80),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  definition: appDefinitionSchema,
  legal: legalSchema,
});

export async function saveApp(appId: string, input: z.input<typeof saveSchema>) {
  const user = await requireUser();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const updated = await db
    .update(schema.apps)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(own(user.id, appId))
    .returning({ slug: schema.apps.slug, published: schema.apps.published });
  if (!updated.length) return { error: "Not found" };
  // A published app must always have a complete Impressum.
  if (updated[0].published && !legalComplete(parsed.data.legal)) {
    await db.update(schema.apps).set({ published: false }).where(own(user.id, appId));
    return { ok: true, unpublished: true };
  }
  revalidatePath(`/s/${updated[0].slug}`, "layout");
  return { ok: true };
}

export async function setPublished(appId: string, published: boolean) {
  const user = await requireUser();
  const [app] = await db.select().from(schema.apps).where(own(user.id, appId));
  if (!app) return { error: "Not found" };
  if (published && !legalComplete(app.legal))
    return { error: "Please complete and save the Impressum (business name, owner, address, e-mail) first." };
  await db.update(schema.apps).set({ published }).where(own(user.id, appId));
  revalidatePath(`/s/${app.slug}`, "layout");
  return { ok: true };
}

export async function deleteApp(appId: string) {
  const user = await requireUser();
  await db.delete(schema.apps).where(own(user.id, appId)); // submissions cascade
  redirect("/dashboard");
}

export async function deleteSubmission(appId: string, submissionId: string) {
  const user = await requireUser();
  const [app] = await db.select({ id: schema.apps.id }).from(schema.apps).where(own(user.id, appId));
  if (!app) return;
  await db
    .delete(schema.submissions)
    .where(and(eq(schema.submissions.id, submissionId), eq(schema.submissions.appId, appId)));
  revalidatePath(`/dashboard/apps/${appId}/submissions`);
}

export async function signOut() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/");
}
