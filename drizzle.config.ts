import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// `npm run db:generate` turns changes in src/db/schema.ts into SQL files in ./drizzle.
// `npm run db:migrate` applies them to DATABASE_URL. `npm run db:studio` opens a DB browser.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
