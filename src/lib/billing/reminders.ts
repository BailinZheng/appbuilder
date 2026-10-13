import "server-only";
import { and, eq, gt, isNotNull, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import { defaultLocale, isLocale } from "@/i18n/config";
import { sendMail } from "@/lib/mail/mailer";
import { hostingReminderMail, type HostingReminderKind } from "@/lib/mail/templates";
import { HOSTING_GRACE_DAYS } from "./catalog";

// Hosting-expiry reminders for published sites, sent by the daily job:
//
//   expires_soon   14 days before the end of the hosting period
//   expires_3d      3 days before
//   expired        period ended, site still online during the grace period
//   offline        grace period over, site offline (sent up to 7 days afterwards, never for old sites)
//
// Only the stage that applies today is sent, so a job that did not run for a few days sends one
// mail, not a burst. Each (app, stage, hosting period) is sent once – guaranteed by a unique index.

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFLINE_NOTICE_DAYS = 7;

export function dueReminder(hostedUntil: Date, now = new Date()): HostingReminderKind | null {
  const until = hostedUntil.getTime();
  const offlineAt = until + HOSTING_GRACE_DAYS * DAY_MS;
  const t = now.getTime();
  if (t < until - 14 * DAY_MS) return null;
  if (t < until - 3 * DAY_MS) return "expires_soon";
  if (t < until) return "expires_3d";
  if (t < offlineAt) return "expired";
  if (t < offlineAt + OFFLINE_NOTICE_DAYS * DAY_MS) return "offline";
  return null;
}

function renewUrl(appId: string) {
  const base = process.env.BETTER_AUTH_URL;
  if (!base) throw new Error("BETTER_AUTH_URL is not set");
  return new URL(`/dashboard/billing?app=${encodeURIComponent(appId)}#hosting-${encodeURIComponent(appId)}`, base).toString();
}

export async function sendHostingReminders(now = new Date()): Promise<{ sent: number; failed: number }> {
  const windowStart = new Date(now.getTime() - (HOSTING_GRACE_DAYS + OFFLINE_NOTICE_DAYS) * DAY_MS);
  const windowEnd = new Date(now.getTime() + 14 * DAY_MS);
  const candidates = await db
    .select({
      appId: schema.apps.id,
      appName: schema.apps.name,
      hostedUntil: schema.apps.hostedUntil,
      name: schema.user.name,
      email: schema.user.email,
      locale: schema.user.locale,
    })
    .from(schema.apps)
    .innerJoin(schema.user, eq(schema.user.id, schema.apps.ownerId))
    .where(
      and(
        eq(schema.apps.published, true),
        isNotNull(schema.apps.hostedUntil),
        gt(schema.apps.hostedUntil, windowStart),
        lt(schema.apps.hostedUntil, windowEnd),
      ),
    );

  let sent = 0;
  let failed = 0;
  for (const c of candidates) {
    const hostedUntil = c.hostedUntil!;
    const kind = dueReminder(hostedUntil, now);
    if (!kind) continue;
    // Claim first: a second job running at the same time skips this reminder.
    const [claim] = await db
      .insert(schema.hostingReminders)
      .values({ id: nanoid(), appId: c.appId, kind, hostedUntil })
      .onConflictDoNothing()
      .returning({ id: schema.hostingReminders.id });
    if (!claim) continue;
    try {
      await sendMail(
        hostingReminderMail(isLocale(c.locale) ? c.locale : defaultLocale, kind, {
          name: c.name,
          email: c.email,
          appName: c.appName,
          hostedUntil,
          offlineAt: new Date(hostedUntil.getTime() + HOSTING_GRACE_DAYS * DAY_MS),
          renewUrl: renewUrl(c.appId),
        }),
      );
      sent++;
    } catch (e) {
      failed++;
      console.error(`[reminders] ${kind} for app ${c.appId} failed – retried on the next run`, e);
      await db.delete(schema.hostingReminders).where(eq(schema.hostingReminders.id, claim.id));
    }
  }
  return { sent, failed };
}
