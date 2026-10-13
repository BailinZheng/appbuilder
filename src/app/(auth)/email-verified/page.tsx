import Link from "next/link";
import { getT } from "@/i18n/server";

// Reached from the confirmation link: Better Auth verifies the token, signs the user in and redirects here
// (with ?error=… if the link was invalid or expired).
export default async function EmailVerified({ searchParams }: PageProps<"/email-verified">) {
  const [t, { error }] = await Promise.all([getT(), searchParams]);
  const button = "block w-full rounded-lg bg-zinc-900 py-2 text-center font-medium text-white";
  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-3 rounded-2xl border bg-white p-6 shadow-sm" role="status">
        {error ? (
          <>
            <h1 className="text-xl font-bold">{t.auth.checkInboxTitle}</h1>
            <p className="text-sm text-red-600">{t.auth.verifyFailed}</p>
            <Link href="/sign-in" className={button}>{t.common.signIn}</Link>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">✅ {t.auth.verifiedTitle}</h1>
            <p className="text-sm text-zinc-600">{t.auth.verifiedText}</p>
            <Link href="/dashboard" className={button}>{t.auth.toDashboard}</Link>
          </>
        )}
      </div>
    </main>
  );
}
