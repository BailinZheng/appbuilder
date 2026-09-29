import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Same PostgreSQL setup locally and in production – only DATABASE_URL differs.
// postgres-js connects lazily, so importing this during `next build` is safe.
function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  return drizzle(postgres(url, { max: 10 }), { schema });
}

// Reuse one connection pool across hot reloads in dev.
const g = globalThis as unknown as { __db?: ReturnType<typeof create> };
export const db = g.__db ?? (g.__db = create());
export { schema };
