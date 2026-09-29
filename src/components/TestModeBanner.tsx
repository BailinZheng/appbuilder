import { getT } from "@/i18n/server";
import { devToolsEnabled } from "@/lib/dev-tools";

/** Always visible while dev tools are on, so a demo is never mistaken for the real thing. */
export async function TestModeBanner() {
  if (!devToolsEnabled()) return null;
  const t = await getT();
  return (
    <div className="bg-amber-400 px-4 py-1 text-center text-xs font-semibold text-amber-950" role="status">
      {t.dev.banner}
    </div>
  );
}
