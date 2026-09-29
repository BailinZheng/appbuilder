"use server";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, schema } from "@/db";

export type ContactState = { ok?: boolean; error?: string };

const contactSchema = z.object({
  slug: z.string().max(40),
  name: z.string().trim().min(1).max(200),
  email: z.email().max(200),
  message: z.string().trim().min(1).max(5000),
  consent: z.literal("on"),
  website: z.string().max(0).optional(), // honeypot must stay empty
});

export async function submitContact(_prev: ContactState, formData: FormData): Promise<ContactState> {
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please fill in all fields and accept the privacy notice." };
  const { slug, name, email, message } = parsed.data;

  const [app] = await db
    .select({ id: schema.apps.id })
    .from(schema.apps)
    .where(and(eq(schema.apps.slug, slug), eq(schema.apps.published, true)));
  if (!app) return { error: "This app is not available." };

  await db.insert(schema.submissions).values({ id: nanoid(), appId: app.id, name, email, message });
  return { ok: true };
}
