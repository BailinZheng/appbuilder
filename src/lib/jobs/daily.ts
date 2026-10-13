import "server-only";
import { sendHostingReminders } from "@/lib/billing/reminders";
import { sweepExpired } from "@/lib/billing/ledger";

/**
 * Daily housekeeping. Run once a day (it is safe to run more often):
 *   npm run jobs:daily              – e.g. as a scheduled task in Coolify, or via cron
 *   POST /api/cron/daily            – with "Authorization: Bearer $CRON_SECRET", for an external scheduler
 */
export async function runDailyJobs(now = new Date()) {
  await sweepExpired(undefined, now); // expired credit lots, stale holds
  const reminders = await sendHostingReminders(now);
  return { reminders };
}
