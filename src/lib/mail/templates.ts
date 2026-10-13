import type { Locale } from "@/i18n/config";
import { intlLocale } from "@/i18n/format";
import type { Mail } from "./mailer";

// E-mail texts in both platform languages. Every mail has a plain-text and a simple HTML part;
// all inserted values are escaped. Dates are shown in German time, where the customers are.

export type HostingReminderKind = "expires_soon" | "expires_3d" | "expired" | "offline";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const day = (d: Date, l: Locale) =>
  d.toLocaleDateString(intlLocale(l), { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });

function layout(l: Locale, opts: { to: string; subject: string; greeting: string; paragraphs: string[]; button?: { label: string; url: string }; footer: string }): Mail {
  const text = [opts.greeting, ...opts.paragraphs, ...(opts.button ? [`${opts.button.label}: ${opts.button.url}`] : []), "—", opts.footer].join("\n\n");
  const html = `<!doctype html><html lang="${l}"><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px">
<tr><td style="font-size:18px;font-weight:bold;padding-bottom:16px">AppBuilder</td></tr>
<tr><td style="font-size:15px;line-height:1.5">
<p>${esc(opts.greeting)}</p>
${opts.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("\n")}
${opts.button ? `<p style="padding:8px 0"><a href="${esc(opts.button.url)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${esc(opts.button.label)}</a></p>
<p style="font-size:12px;color:#71717a;word-break:break-all">${esc(opts.button.url)}</p>` : ""}
</td></tr>
<tr><td style="font-size:12px;color:#71717a;padding-top:16px;border-top:1px solid #e4e4e7">${esc(opts.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  return { to: opts.to, subject: opts.subject, text, html };
}

const T = {
  de: {
    hello: (name: string) => `Hallo ${name},`,
    footer: "Sie erhalten diese E-Mail, weil Sie ein Konto bei AppBuilder haben.",
    ignore: "Falls Sie das nicht waren, können Sie diese E-Mail ignorieren.",
    verify: {
      subject: "Bitte bestätigen Sie Ihre E-Mail-Adresse",
      body: "bitte bestätigen Sie Ihre E-Mail-Adresse, um Ihr AppBuilder-Konto zu aktivieren. Der Link ist 24 Stunden gültig.",
      button: "E-Mail-Adresse bestätigen",
    },
    reset: {
      subject: "Passwort zurücksetzen",
      body: "Sie haben ein neues Passwort für Ihr AppBuilder-Konto angefordert. Der Link ist 1 Stunde gültig.",
      button: "Neues Passwort festlegen",
    },
    hosting: {
      renew: "Hosting verlängern",
      expires_soon: {
        subject: (app: string, until: string) => `Ihr Hosting für „${app}“ läuft am ${until} ab`,
        body: (app: string, until: string, offline: string) =>
          `das Hosting Ihrer Website „${app}“ läuft am ${until} ab. Verlängern Sie es rechtzeitig, damit Ihre Website erreichbar bleibt. Nach Ablauf bleibt sie noch bis ${offline} online.`,
      },
      expires_3d: {
        subject: (app: string, until: string) => `Erinnerung: Hosting für „${app}“ endet am ${until}`,
        body: (app: string, until: string, offline: string) =>
          `in wenigen Tagen, am ${until}, endet das Hosting Ihrer Website „${app}“. Ohne Verlängerung geht sie am ${offline} offline.`,
      },
      expired: {
        subject: (app: string) => `Hosting für „${app}“ abgelaufen – Website geht bald offline`,
        body: (app: string, until: string, offline: string) =>
          `das Hosting Ihrer Website „${app}“ ist am ${until} abgelaufen. Sie ist noch bis ${offline} online und geht danach offline, wenn Sie nicht verlängern.`,
      },
      offline: {
        subject: (app: string) => `„${app}“ ist offline`,
        body: (app: string) =>
          `Ihre Website „${app}“ ist jetzt offline, weil das Hosting abgelaufen ist. Es wurde nichts gelöscht: Sobald Sie verlängern, ist sie sofort wieder erreichbar.`,
      },
    },
  },
  en: {
    hello: (name: string) => `Hello ${name},`,
    footer: "You are receiving this e-mail because you have an AppBuilder account.",
    ignore: "If this wasn't you, you can ignore this e-mail.",
    verify: {
      subject: "Please confirm your e-mail address",
      body: "please confirm your e-mail address to activate your AppBuilder account. The link is valid for 24 hours.",
      button: "Confirm e-mail address",
    },
    reset: {
      subject: "Reset your password",
      body: "You asked for a new password for your AppBuilder account. The link is valid for 1 hour.",
      button: "Choose a new password",
    },
    hosting: {
      renew: "Renew hosting",
      expires_soon: {
        subject: (app: string, until: string) => `Your hosting for "${app}" ends on ${until}`,
        body: (app: string, until: string, offline: string) =>
          `the hosting for your website "${app}" ends on ${until}. Renew it in time to keep your website online. After that date it stays online until ${offline}.`,
      },
      expires_3d: {
        subject: (app: string, until: string) => `Reminder: hosting for "${app}" ends on ${until}`,
        body: (app: string, until: string, offline: string) =>
          `in a few days, on ${until}, the hosting for your website "${app}" ends. Without a renewal it goes offline on ${offline}.`,
      },
      expired: {
        subject: (app: string) => `Hosting for "${app}" has ended – your website goes offline soon`,
        body: (app: string, until: string, offline: string) =>
          `the hosting for your website "${app}" ended on ${until}. It stays online until ${offline} and then goes offline unless you renew.`,
      },
      offline: {
        subject: (app: string) => `"${app}" is offline`,
        body: (app: string) =>
          `your website "${app}" is now offline because its hosting has ended. Nothing was deleted: as soon as you renew, it is back online.`,
      },
    },
  },
} satisfies Record<Locale, unknown>;

export function verifyEmailMail(l: Locale, user: { name: string; email: string }, url: string): Mail {
  const t = T[l];
  return layout(l, {
    to: user.email,
    subject: t.verify.subject,
    greeting: t.hello(user.name),
    paragraphs: [t.verify.body, t.ignore],
    button: { label: t.verify.button, url },
    footer: t.footer,
  });
}

export function resetPasswordMail(l: Locale, user: { name: string; email: string }, url: string): Mail {
  const t = T[l];
  return layout(l, {
    to: user.email,
    subject: t.reset.subject,
    greeting: t.hello(user.name),
    paragraphs: [t.reset.body, t.ignore],
    button: { label: t.reset.button, url },
    footer: t.footer,
  });
}

export function hostingReminderMail(
  l: Locale,
  kind: HostingReminderKind,
  data: { name: string; email: string; appName: string; hostedUntil: Date; offlineAt: Date; renewUrl: string },
): Mail {
  const t = T[l];
  const until = day(data.hostedUntil, l);
  const offline = day(data.offlineAt, l);
  const k = t.hosting[kind];
  return layout(l, {
    to: data.email,
    subject: k.subject(data.appName, until),
    greeting: t.hello(data.name),
    paragraphs: [k.body(data.appName, until, offline)],
    button: { label: t.hosting.renew, url: data.renewUrl },
    footer: t.footer,
  });
}
