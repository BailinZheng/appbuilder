import { createHash, timingSafeEqual } from "node:crypto";
import { runDailyJobs } from "@/lib/jobs/daily";

// Trigger for the daily job from an external scheduler: POST with "Authorization: Bearer <CRON_SECRET>".

const digest = (s: string) => createHash("sha256").update(s).digest();

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("Cron not configured", { status: 503 });
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!timingSafeEqual(digest(given), digest(secret))) return new Response("Unauthorized", { status: 401 });

  try {
    return Response.json(await runDailyJobs());
  } catch (e) {
    console.error("[cron] daily jobs failed", e);
    return new Response("Daily jobs failed", { status: 500 });
  }
}
