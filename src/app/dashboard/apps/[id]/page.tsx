import { and, count, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getBalance } from "@/lib/billing/ledger";
import { appUrl } from "@/lib/urls";
import { Editor } from "./editor";

export default async function EditAppPage({ params }: PageProps<"/dashboard/apps/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const [app] = await db
    .select()
    .from(schema.apps)
    .where(and(eq(schema.apps.id, id), eq(schema.apps.ownerId, user.id)));
  if (!app) notFound();
  const [[{ n }], [{ versions }], balance] = await Promise.all([
    db.select({ n: count() }).from(schema.submissions).where(eq(schema.submissions.appId, app.id)),
    db.select({ versions: count() }).from(schema.appVersions).where(eq(schema.appVersions.appId, app.id)),
    getBalance(user.id),
  ]);

  return (
    <Editor app={app} publicUrl={appUrl(app.slug)} submissionCount={n} balance={balance} canUndo={versions > 0} />
  );
}
