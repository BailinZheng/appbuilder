import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { appUrl } from "@/lib/urls";
import { CreateAppForm } from "./create-app-form";

export default async function Dashboard() {
  const user = await requireUser();
  const apps = await db
    .select()
    .from(schema.apps)
    .where(eq(schema.apps.ownerId, user.id))
    .orderBy(desc(schema.apps.createdAt));

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_320px]">
      <section>
        <h1 className="mb-4 text-2xl font-bold">Your apps</h1>
        {apps.length === 0 && <p className="text-zinc-500">No apps yet – create your first one.</p>}
        <ul className="space-y-3">
          {apps.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-xl border bg-white p-4">
              <div className="flex items-center gap-3">
                <span className="h-8 w-8 rounded-lg" style={{ background: a.themeColor }} />
                <div>
                  <p className="font-medium">{a.name}</p>
                  <p className="text-sm text-zinc-500">
                    {a.published ? (
                      <a href={appUrl(a.slug)} target="_blank" className="underline">{appUrl(a.slug)}</a>
                    ) : (
                      "Draft – not published"
                    )}
                  </p>
                </div>
              </div>
              <Link href={`/dashboard/apps/${a.id}`} className="rounded-lg border px-3 py-1.5 text-sm">
                Edit
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <aside className="h-fit rounded-xl border bg-white p-5">
        <h2 className="mb-3 font-semibold">New app</h2>
        <CreateAppForm />
      </aside>
    </div>
  );
}
