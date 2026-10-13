import { notFound } from "next/navigation";
import { formatDateTime } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { readOutbox } from "@/lib/mail/mailer";

// Dev mail outbox (MAIL_PROVIDER=log). No login needed – a new account has to open its confirmation link
// before it can sign in. Because it shows password-reset links of every account, it only exists on the
// local development server, never in a production build (even with ENABLE_DEV_TOOLS=true).
export default async function DevMailPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const [t, locale, mails] = await Promise.all([getT(), getLocale(), readOutbox(20)]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t.dev.mailTitle}</h1>
        <p className="text-sm text-zinc-500">{t.dev.mailIntro}</p>
      </div>
      {mails.length === 0 && <p className="text-sm text-zinc-500">{t.dev.mailEmpty}</p>}
      <ul className="space-y-3">
        {mails.map((m) => {
          const link = m.text.match(/https?:\/\/\S+/)?.[0];
          return (
            <li key={m.id} className="rounded-xl border bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{m.subject}</p>
                <p className="text-xs text-zinc-500">{formatDateTime(new Date(m.sentAt), locale)}</p>
              </div>
              <p className="text-sm text-zinc-600">→ {m.to}</p>
              <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700">{m.text}</pre>
              {link && (
                <a href={link} className="mt-2 inline-block rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white">
                  {t.dev.mailOpenLink}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
