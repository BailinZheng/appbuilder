import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { getLocale, getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { deleteSubmission } from "../../../actions";

export default async function SubmissionsPage({ params }: PageProps<"/dashboard/apps/[id]/submissions">) {
  const { id } = await params;
  const user = await requireUser();
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const [app] = await db
    .select()
    .from(schema.apps)
    .where(and(eq(schema.apps.id, id), eq(schema.apps.ownerId, user.id)));
  if (!app) notFound();
  const rows = await db
    .select()
    .from(schema.submissions)
    .where(eq(schema.submissions.appId, app.id))
    .orderBy(desc(schema.submissions.createdAt));
  const dateLocale = locale === "de" ? "de-DE" : "en-GB";

  return (
    <div className="space-y-4">
      <Link href={`/dashboard/apps/${app.id}`} className="text-sm text-zinc-500">← {app.name}</Link>
      <h1 className="text-2xl font-bold">{t.submissions.title}</h1>
      <p className="text-sm text-zinc-500">{t.submissions.gdprHint}</p>
      {rows.length === 0 && <p className="text-zinc-500">{t.submissions.empty}</p>}
      <ul className="space-y-3">
        {rows.map((s) => (
          <li key={s.id} className="rounded-xl border bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">
                  {s.name} · <a href={`mailto:${s.email}`} className="underline">{s.email}</a>
                </p>
                <p className="text-xs text-zinc-500">{s.createdAt.toLocaleString(dateLocale)}</p>
              </div>
              <form action={deleteSubmission.bind(null, app.id, s.id)}>
                <button className="text-sm text-red-600 underline">{t.submissions.delete}</button>
              </form>
            </div>
            <p className="mt-2 whitespace-pre-line text-zinc-700">{s.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
