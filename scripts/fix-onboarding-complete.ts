#!/usr/bin/env tsx
// scripts/fix-onboarding-complete.ts
//
// One-time: mark all existing tenants as onboarding_complete so they are
// not sent through the new onboarding flow. Safe to run multiple times.
//
// Usage:
//   DATABASE_URL=<your-railway-url> tsx scripts/fix-onboarding-complete.ts
//
// Dry run (no writes):
//   DATABASE_URL=<your-railway-url> tsx scripts/fix-onboarding-complete.ts --dry-run
//
// Get DATABASE_URL from: Railway dashboard → qyro-db → Variables → DATABASE_URL

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(__dirname, "../.env.local") });
config({ path: path.resolve(__dirname, "../.env") });

import postgres from "postgres";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is not set.");
    console.error("Run: DATABASE_URL=<url> tsx scripts/fix-onboarding-complete.ts");
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1 });

  console.log(`Mode: ${dryRun ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log("");

  // Count affected rows first
  const countResult = await sql`
    SELECT COUNT(*) AS n
    FROM tenants
    WHERE metadata->>'onboarding_complete' IS NULL
       OR metadata->>'onboarding_complete' = 'false'
  `;
  const affected = Number(countResult[0].n);
  console.log(`Tenants with onboarding_complete unset or false: ${affected}`);

  if (affected === 0) {
    console.log("Nothing to update.");
    await sql.end();
    return;
  }

  // Show which tenants will be updated
  const rows = await sql`
    SELECT id, name, created_at, metadata->>'onboarding_complete' AS onboarding_complete
    FROM tenants
    WHERE metadata->>'onboarding_complete' IS NULL
       OR metadata->>'onboarding_complete' = 'false'
    ORDER BY created_at
  `;
  console.log("\nTenants to be updated:");
  for (const row of rows) {
    console.log(`  ${row.id}  ${String(row.name).padEnd(35)} created=${row.created_at}  onboarding_complete=${row.onboarding_complete ?? "NULL"}`);
  }

  if (dryRun) {
    console.log("\nDry run — no changes made. Remove --dry-run to apply.");
    await sql.end();
    return;
  }

  const result = await sql`
    UPDATE tenants
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'),
      '{onboarding_complete}',
      'true'
    )
    WHERE metadata->>'onboarding_complete' IS NULL
       OR metadata->>'onboarding_complete' = 'false'
    RETURNING id, name
  `;

  console.log(`\nUpdated ${result.length} tenant(s):`);
  for (const row of result) {
    console.log(`  ${row.id}  ${row.name}`);
  }
  console.log("\nDone.");

  await sql.end();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
