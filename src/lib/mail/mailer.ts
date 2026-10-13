import "server-only";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import nodemailer, { type Transporter } from "nodemailer";
import { devToolsEnabled } from "@/lib/dev-tools";

// Outgoing e-mail (verification, password reset, hosting reminders).
//
// MAIL_PROVIDER=log   (default while ENABLE_DEV_TOOLS=true) nothing is sent; every mail is written to
//                     MAIL_OUTBOX_DIR (default ./data/outbox, git-ignored) and listed on /dev/mail
// MAIL_PROVIDER=smtp  SMTP_URL, e.g. smtps://user:password@smtp-relay.brevo.com:465, and MAIL_FROM
//
// Without a provider outside dev mode, sending fails loudly – verification mails must never vanish.

export type Mail = { to: string; subject: string; text: string; html: string };
export type OutboxEntry = Mail & { id: string; sentAt: string };

const outboxDir = () => process.env.MAIL_OUTBOX_DIR ?? path.join(process.cwd(), "data", "outbox");

function provider(): "log" | "smtp" {
  const id = process.env.MAIL_PROVIDER ?? (devToolsEnabled() ? "log" : undefined);
  if (id === "log" || id === "smtp") return id;
  throw new Error(id ? `Unknown MAIL_PROVIDER "${id}"` : "MAIL_PROVIDER is not configured (log or smtp)");
}

let transport: Transporter | undefined;

export async function sendMail(mail: Mail): Promise<void> {
  if (provider() === "log") {
    const entry: OutboxEntry = { ...mail, id: `${Date.now()}-${nanoid(6)}`, sentAt: new Date().toISOString() };
    await mkdir(outboxDir(), { recursive: true });
    await writeFile(path.join(outboxDir(), `${entry.id}.json`), JSON.stringify(entry, null, 2));
    console.info(`[mail] (outbox) to=${mail.to} subject="${mail.subject}"`);
    return;
  }
  const url = process.env.SMTP_URL;
  const from = process.env.MAIL_FROM;
  if (!url || !from) throw new Error("SMTP_URL and MAIL_FROM must be set for MAIL_PROVIDER=smtp");
  transport ??= nodemailer.createTransport(url);
  await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
}

/** Fire-and-forget for auth mails: answering at the same speed whether or not an account exists. */
export function sendMailInBackground(mail: Mail, what: string) {
  void sendMail(mail).catch((e) => console.error(`[mail] ${what} to ${mail.to} failed`, e));
}

/** Newest first – for the dev outbox page and tests. */
export async function readOutbox(limit = 20): Promise<OutboxEntry[]> {
  const files = await readdir(outboxDir()).catch(() => [] as string[]);
  const newest = files.filter((f) => f.endsWith(".json")).sort().reverse().slice(0, limit);
  return Promise.all(newest.map(async (f) => JSON.parse(await readFile(path.join(outboxDir(), f), "utf8")) as OutboxEntry));
}
