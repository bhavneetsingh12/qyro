// QYRO Database Migration Runner
// Applies all pending SQL migration files in packages/db/migrations/ in order.
// Tracks applied migrations in a `schema_migrations` table to avoid re-running.
//
// Run: npx tsx infra/migrate.ts
// Safe to re-run — skips already-applied migrations.

import { config } from "dotenv";
config({ path: ".env.local" });
config();
import postgres from "postgres";
import * as fs from "fs";
import * as path from "path";

const { DATABASE_URL } = process.env;

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set. Copy .env.example → .env.local and fill it in.");
  process.exit(1);
}

const client = postgres(DATABASE_URL, { max: 1 });

const MIGRATIONS_DIR = path.resolve(__dirname, "../packages/db/migrations");

async function run() {
  // Create tracking table if it doesn't exist
  await client`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Read all .sql files sorted by name
  const allFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Find already-applied migrations
  const applied = await client<{ filename: string }[]>`
    SELECT filename FROM schema_migrations
  `;
  const appliedSet = new Set(applied.map((r) => r.filename));

  const pending = allFiles.filter((f) => !appliedSet.has(f));

  if (pending.length === 0) {
    console.log("✓ All migrations already applied. Nothing to do.");
    await client.end();
    return;
  }

  console.log(`Applying ${pending.length} migration(s)...`);

  for (const filename of pending) {
    const filePath = path.join(MIGRATIONS_DIR, filename);
    const sql = fs.readFileSync(filePath, "utf-8");

    console.log(`  → ${filename}`);
    try {
      // Run the migration SQL (may contain multiple statements)
      await client.unsafe(sql);
      // Record it as applied
      await client`
        INSERT INTO schema_migrations (filename) VALUES (${filename})
        ON CONFLICT (filename) DO NOTHING
      `;
      console.log(`    ✓ done`);
    } catch (err) {
      console.error(`    ✗ FAILED: ${(err as Error).message}`);
      await client.end();
      process.exit(1);
    }
  }

  console.log("✓ All migrations applied.");
  await client.end();
}

run().catch((err) => {
  console.error("Migration runner error:", err);
  process.exit(1);
});
