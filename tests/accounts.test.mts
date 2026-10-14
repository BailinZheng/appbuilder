// E-mail verification, password reset, hosting reminders and the daily job. Run with `npm test`.
// Mails go to a temporary outbox (MAIL_PROVIDER=log) – nothing is sent, no mail account needed.
import "dotenv/config";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
process.env.DATABASE_URL = testUrl;
const BASE = "http://localhost:3000";
process.env.BETTER_AUTH_URL = BASE;
process.env.BETTER_AUTH_SECRET ??= "test-secret-for-better-auth-0123456789";
process.env.MAIL_PROVIDER = "log";
const outbox = await mkdtemp(path.join(tmpdir(), "appbuilder-outbox-"));
process.env.MAIL_OUTBOX_DIR = outbox;
// The daily job also cleans up media: never let it touch the development uploads.
const mediaDir = await mkdtemp(path.join(tmpdir(), "appbuilder-media-"));
process.env.MEDIA_STORAGE = "local";
process.env.MEDIA_DIR = mediaDir;
process.env.CRON_SECRET = "test-cron-secret";

const { db, schema } = await import("@/db");
const { sql, eq } = await import("drizzle-orm");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const { auth } = await import("@/lib/auth");
const { readOutbox, sendMail } = await import("@/lib/mail/mailer");
const { hostingReminderMail, verifyEmailMail } = await import("@/lib/mail/templates");
const { dueReminder, sendHostingReminders } = await import("@/lib/billing/reminders");
const { POST: cron } = await import("@/app/api/cron/daily/route");
const { emptyLegal } = await import("@/lib/app-definition");

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

before(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE hosting_reminders, free_previews, media, ai_usage, credit_transactions, credit_holds, credit_lots, purchases, app_versions, submissions, apps, session, account, verification, "user"`,
  );
  await rm(outbox, { recursive: true, force: true });
});

after(async () => {
  await db.$client.end();
  await rm(outbox, { recursive: true, force: true });
  await rm(mediaDir, { recursive: true, force: true });
});

/** A request to Better Auth's handler, as the browser would send it (own IP per request: no rate limit clash). */
function call(pathname: string, opts: { body?: object; cookie?: string } = {}) {
  const headers: Record<string, string> = { origin: BASE, "x-forwarded-for": `198.51.100.${++seq % 250}` };
  if (opts.body) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = opts.cookie;
  return auth.handler(
    new Request(new URL(pathname, BASE), { method: opts.body ? "POST" : "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined }),
  );
}

/** Auth mails are sent in the background – wait until one for `to` arrives. */
async function mailTo(to: string, subject: RegExp) {
  for (let i = 0; i < 50; i++) {
    const mail = (await readOutbox(50)).find((m) => m.to === to && subject.test(m.subject));
    if (mail) return mail;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`No mail to ${to} matching ${subject}`);
}

const linkIn = (text: string) => new URL(text.match(/https?:\/\/\S+/)![0]);

describe("e-mail verification and password reset", () => {
  test("sign up → no session until the link is opened → signed in, language remembered", async () => {
    const email = `new${++seq}@example.test`;
    const password = "first-password-123";
    const signUp = await call("/api/auth/sign-up/email", {
      body: { name: "Lena", email, password, callbackURL: "/email-verified" },
      cookie: "lang=en",
    });
    assert.equal(signUp.status, 200);
    assert.equal((await signUp.json()).token, null, "no session before confirmation");

    const mail = await mailTo(email, /confirm your e-mail/);
    assert.match(mail.text, /Hello Lena/);
    const blocked = await call("/api/auth/sign-in/email", { body: { email, password } });
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).code, "EMAIL_NOT_VERIFIED");

    const link = linkIn(mail.text);
    assert.equal(link.origin, BASE);
    const verified = await call(link.pathname + link.search);
    assert.equal(verified.status, 302);
    assert.equal(verified.headers.get("location"), "/email-verified");
    assert.match(verified.headers.get("set-cookie") ?? "", /session_token=/, "signed in right away");
    const [user] = await db.select().from(schema.user).where(eq(schema.user.email, email));
    assert.equal(user.emailVerified, true);
    assert.equal(user.locale, "en");

    assert.equal((await call("/api/auth/sign-in/email", { body: { email, password } })).status, 200);
  });

  test("an invalid confirmation link leads to the error page", async () => {
    const res = await call("/api/auth/verify-email?token=not-a-token&callbackURL=%2Femail-verified");
    assert.equal(res.status, 302);
    assert.match(res.headers.get("location") ?? "", /^\/email-verified\?error=/);
  });

  test("password reset: link by mail, new password works, old one and other sessions do not", async () => {
    const email = `reset${++seq}@example.test`;
    await call("/api/auth/sign-up/email", { body: { name: "Tom", email, password: "old-password-123" } });
    const confirm = linkIn((await mailTo(email, /Bestätigen|bestätigen/)).text);
    await call(confirm.pathname + confirm.search);
    const signIn = await call("/api/auth/sign-in/email", { body: { email, password: "old-password-123" } });
    assert.equal(signIn.status, 200);

    assert.equal((await call("/api/auth/request-password-reset", { body: { email, redirectTo: "/reset-password" } })).status, 200);
    const resetMail = await mailTo(email, /Passwort zurücksetzen/);
    const link = linkIn(resetMail.text);
    const landing = await call(link.pathname + link.search);
    assert.equal(landing.status, 302);
    const token = new URL(landing.headers.get("location")!, BASE).searchParams.get("token");
    assert.ok(token);

    assert.equal((await call("/api/auth/reset-password", { body: { newPassword: "new-password-456", token } })).status, 200);
    assert.equal((await call("/api/auth/sign-in/email", { body: { email, password: "old-password-123" } })).status, 401);
    assert.equal((await call("/api/auth/sign-in/email", { body: { email, password: "new-password-456" } })).status, 200);
    const [user] = await db.select().from(schema.user).where(eq(schema.user.email, email));
    const sessions = await db.select().from(schema.session).where(eq(schema.session.userId, user.id));
    assert.equal(sessions.length, 1, "sessions from before the reset are revoked");
    assert.equal((await call("/api/auth/reset-password", { body: { newPassword: "third-password-789", token } })).status, 400, "token is single-use");
  });

  test("unknown addresses get the same answer and no mail", async () => {
    const res = await call("/api/auth/request-password-reset", { body: { email: "nobody@example.test", redirectTo: "/reset-password" } });
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await readOutbox()).length, 0);
  });
});

describe("mails", () => {
  test("values are escaped in the HTML part", () => {
    const mail = verifyEmailMail("de", { name: `<img src=x onerror=alert(1)>`, email: "a@example.test" }, "https://x.test/?a=1&b=2");
    assert.doesNotMatch(mail.html, /<img src=x/);
    assert.match(mail.html, /&lt;img src=x/);
    assert.match(mail.html, /href="https:\/\/x\.test\/\?a=1&amp;b=2"/);
    assert.match(mail.text, /https:\/\/x\.test\/\?a=1&b=2/);
  });

  test("without a provider outside dev mode, sending fails instead of dropping the mail", async () => {
    const saved = { provider: process.env.MAIL_PROVIDER, dev: process.env.ENABLE_DEV_TOOLS };
    delete process.env.MAIL_PROVIDER;
    process.env.ENABLE_DEV_TOOLS = "false";
    try {
      await assert.rejects(sendMail({ to: "a@example.test", subject: "x", text: "x", html: "x" }), /MAIL_PROVIDER is not configured/);
    } finally {
      process.env.MAIL_PROVIDER = saved.provider;
      process.env.ENABLE_DEV_TOOLS = saved.dev;
    }
  });
});

// ---------------------------------------------------------------------------
// Hosting reminders
// ---------------------------------------------------------------------------

const now = new Date("2026-10-13T08:00:00Z");

async function publishedApp(hostedUntil: Date | null, opts: { published?: boolean; locale?: string } = {}) {
  const userId = `ru${++seq}`;
  await db.insert(schema.user).values({ id: userId, name: "Anna", email: `${userId}@example.test`, emailVerified: true, locale: opts.locale ?? "de" });
  const appId = `ra${seq}`;
  await db.insert(schema.apps).values({
    id: appId,
    ownerId: userId,
    slug: `reminder-${seq}`,
    name: "Café Anna",
    definition: { version: 1, blocks: [] },
    legal: emptyLegal,
    published: opts.published ?? true,
    hostedUntil,
  });
  return { appId, email: `${userId}@example.test` };
}

describe("hosting reminders", () => {
  test("stages: 14 days, 3 days, expired (grace), offline (for 7 days), then silence", () => {
    const until = new Date(now.getTime() + 20 * DAY);
    const at = (days: number) => new Date(until.getTime() + days * DAY);
    assert.equal(dueReminder(until, at(-15)), null);
    assert.equal(dueReminder(until, at(-14)), "expires_soon");
    assert.equal(dueReminder(until, at(-3.5)), "expires_soon");
    assert.equal(dueReminder(until, at(-3)), "expires_3d");
    assert.equal(dueReminder(until, at(0)), "expired");
    assert.equal(dueReminder(until, at(13.9)), "expired");
    assert.equal(dueReminder(until, at(14)), "offline");
    assert.equal(dueReminder(until, at(21)), null);
  });

  test("each reminder is sent once per hosting period, in the owner's language", async () => {
    const soon = await publishedApp(new Date(now.getTime() + 10 * DAY), { locale: "en" });
    const grace = await publishedApp(new Date(now.getTime() - 2 * DAY));
    await publishedApp(new Date(now.getTime() + 10 * DAY), { published: false }); // drafts get no reminders
    await publishedApp(new Date(now.getTime() - 40 * DAY)); // long offline – no more mails
    await publishedApp(new Date(now.getTime() + 60 * DAY)); // far away

    assert.deepEqual(await sendHostingReminders(now), { sent: 2, failed: 0 });
    assert.deepEqual(await sendHostingReminders(now), { sent: 0, failed: 0 }, "second run sends nothing");

    const mails = await readOutbox();
    const soonMail = mails.find((m) => m.to === soon.email)!;
    assert.match(soonMail.subject, /Your hosting for "Café Anna" ends on 23\/10\/2026/);
    assert.match(soonMail.text, new RegExp(`/dashboard/billing\\?app=${soon.appId}#hosting-${soon.appId}`));
    const graceMail = mails.find((m) => m.to === grace.email)!;
    assert.match(graceMail.subject, /abgelaufen/);
    assert.match(graceMail.text, /noch bis 25\.10\.2026 online/);

    // Three days before the end the next stage follows; a renewal starts a new cycle.
    assert.equal((await sendHostingReminders(new Date(now.getTime() + 8 * DAY))).sent, 1);
    await db.update(schema.apps).set({ hostedUntil: new Date(now.getTime() + 12 * DAY) }).where(eq(schema.apps.id, soon.appId));
    assert.equal((await sendHostingReminders(now)).sent, 1);
  });

  test("a failed send is retried on the next run", async () => {
    const app = await publishedApp(new Date(now.getTime() + 5 * DAY));
    process.env.MAIL_PROVIDER = "smtp"; // no SMTP_URL → sending fails
    try {
      assert.deepEqual(await sendHostingReminders(now), { sent: 0, failed: 1 });
    } finally {
      process.env.MAIL_PROVIDER = "log";
    }
    assert.deepEqual(await sendHostingReminders(now), { sent: 1, failed: 0 });
    assert.equal((await readOutbox()).filter((m) => m.to === app.email).length, 1);
  });

  test("template mentions the offline date in both languages", () => {
    const data = { name: "A", email: "a@example.test", appName: "X", hostedUntil: now, offlineAt: new Date(now.getTime() + 14 * DAY), renewUrl: "https://x.test" };
    assert.match(hostingReminderMail("de", "expires_3d", data).text, /am 27\.10\.2026 offline/);
    assert.match(hostingReminderMail("en", "offline", data).text, /Nothing was deleted/);
  });
});

describe("daily job endpoint", () => {
  test("requires the cron secret", async () => {
    const req = (auth?: string) =>
      new Request(`${BASE}/api/cron/daily`, { method: "POST", headers: auth ? { authorization: auth } : {} });
    assert.equal((await cron(req())).status, 401);
    assert.equal((await cron(req("Bearer wrong"))).status, 401);
    const ok = await cron(req("Bearer test-cron-secret"));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), {
      reminders: { sent: 0, failed: 0 },
      media: { unusedDeleted: 0, orphanedFilesDeleted: 0, failed: 0 },
    });
  });
});
