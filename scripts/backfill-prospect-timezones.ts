import {
  adminDb,
  closeDb,
  inferProspectTimezone,
  prospectsRaw,
} from "../packages/db/src/index";
import { and, eq, isNull } from "drizzle-orm";

type ProspectRow = typeof prospectsRaw.$inferSelect;

function getArgValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const apply = hasFlag("--apply");
  const tenantId = getArgValue("--tenant");

  const rows = await adminDb.query.prospectsRaw.findMany({
    where: tenantId
      ? and(eq(prospectsRaw.tenantId, tenantId), isNull(prospectsRaw.prospectTimezone))
      : isNull(prospectsRaw.prospectTimezone),
    columns: {
      id: true,
      tenantId: true,
      businessName: true,
      address: true,
      prospectTimezone: true,
    },
  });

  let rowsScanned = 0;
  let rowsResolvable = 0;
  let rowsUpdated = 0;
  let rowsUnresolved = 0;

  for (const row of rows as Array<Pick<ProspectRow, "id" | "tenantId" | "businessName" | "address" | "prospectTimezone">>) {
    rowsScanned += 1;
    const inferred = inferProspectTimezone(row.address ?? null);

    if (!inferred) {
      rowsUnresolved += 1;
      console.log(`[unresolved] tenant=${row.tenantId} prospect=${row.id} business=${row.businessName}`);
      continue;
    }

    rowsResolvable += 1;

    if (!apply) {
      console.log(`[dry-run] tenant=${row.tenantId} prospect=${row.id} timezone=${inferred}`);
      continue;
    }

    await adminDb
      .update(prospectsRaw)
      .set({ prospectTimezone: inferred })
      .where(eq(prospectsRaw.id, row.id));

    rowsUpdated += 1;
    console.log(`[updated] tenant=${row.tenantId} prospect=${row.id} timezone=${inferred}`);
  }

  console.log("");
  console.log(`mode: ${apply ? "apply" : "dry-run"}`);
  console.log(`tenant filter: ${tenantId ?? "all"}`);
  console.log(`rows scanned: ${rowsScanned}`);
  console.log(`rows resolvable: ${rowsResolvable}`);
  console.log(`rows updated: ${rowsUpdated}`);
  console.log(`rows unresolved: ${rowsUnresolved}`);
}

main()
  .catch((error) => {
    console.error("[backfill:prospect-timezones] failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
