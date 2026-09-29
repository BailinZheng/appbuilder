// Dev/demo only: grant test credits to a user.
//   npm run dev:grant-credits -- <email> <amount> [note]
import "dotenv/config";

if (process.env.ENABLE_DEV_TOOLS !== "true") {
  console.error("Refusing: ENABLE_DEV_TOOLS is not true (test credits are a development/demo feature).");
  process.exit(1);
}

const [email, amountArg, ...noteParts] = process.argv.slice(2);
const amount = Number(amountArg);
if (!email || !Number.isInteger(amount) || amount <= 0) {
  console.error("Usage: npm run dev:grant-credits -- <email> <amount> [note]");
  process.exit(1);
}

const { db, schema } = await import("@/db");
const { eq } = await import("drizzle-orm");
const { grantCredits, getBalance } = await import("@/lib/billing/ledger");
const { addMonths, TEST_CREDIT_VALIDITY_MONTHS } = await import("@/lib/billing/catalog");

try {
  const [user] = await db.select().from(schema.user).where(eq(schema.user.email, email.toLowerCase()));
  if (!user) throw new Error(`No user with e-mail ${email}`);
  await grantCredits({
    userId: user.id,
    amount,
    source: "test",
    externalRef: `test:cli:${crypto.randomUUID()}`,
    expiresAt: addMonths(new Date(), TEST_CREDIT_VALIDITY_MONTHS),
    note: noteParts.join(" ") || "CLI test grant",
  });
  console.log(`✓ Granted ${amount} test credits to ${email}. New balance: ${await getBalance(user.id)}`);
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
