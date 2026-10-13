// Daily housekeeping: expired credits, stale holds, hosting-expiry reminders.
//   npm run jobs:daily
// Schedule it once a day (e.g. a Coolify scheduled task or cron). Running it more often is safe.
import "dotenv/config";

const { runDailyJobs } = await import("@/lib/jobs/daily");
const { db } = await import("@/db");

try {
  const result = await runDailyJobs();
  console.log(`✓ Daily jobs done. Reminders sent: ${result.reminders.sent}, failed: ${result.reminders.failed}`);
  if (result.reminders.failed > 0) process.exitCode = 1;
} catch (e) {
  console.error("✗ Daily jobs failed", e);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
