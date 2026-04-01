import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for migrations");
}

export default defineConfig({
  schema:    "./src/schema.ts",
  out:       "./migrations",
  dialect:   "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict:  true,
});