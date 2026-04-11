import {
  adminDb,
  closeDb,
  encryptSecret,
  isEncryptedSecret,
  tenantIntegrationSecrets,
} from "../packages/db/src/index";
import { eq } from "drizzle-orm";

type SecretField = "calendarApiKey" | "apolloApiKey" | "hunterApiKey";

type SecretRow = typeof tenantIntegrationSecrets.$inferSelect;

const SECRET_FIELDS: SecretField[] = ["calendarApiKey", "apolloApiKey", "hunterApiKey"];

function getArgValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function summarizeField(value: string | null): "empty" | "encrypted" | "plaintext" {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "empty";
  return isEncryptedSecret(normalized) ? "encrypted" : "plaintext";
}

async function main(): Promise<void> {
  const apply = hasFlag("--apply");
  const tenantId = getArgValue("--tenant");

  const rows = await adminDb.query.tenantIntegrationSecrets.findMany({
    ...(tenantId
      ? {
          where: eq(tenantIntegrationSecrets.tenantId, tenantId),
        }
      : {}),
  });

  let rowsScanned = 0;
  let rowsNeedingUpdate = 0;
  let rowsUpdated = 0;
  let plaintextFieldCount = 0;
  let encryptedFieldCount = 0;
  let emptyFieldCount = 0;

  for (const row of rows) {
    rowsScanned += 1;

    const updatePatch: Partial<Pick<SecretRow, SecretField | "updatedAt">> = {};
    const plaintextFields: SecretField[] = [];

    for (const field of SECRET_FIELDS) {
      const value = row[field];
      const status = summarizeField(value);

      if (status === "empty") {
        emptyFieldCount += 1;
        continue;
      }

      if (status === "encrypted") {
        encryptedFieldCount += 1;
        continue;
      }

      plaintextFieldCount += 1;
      plaintextFields.push(field);
      updatePatch[field] = encryptSecret(String(value));
    }

    if (plaintextFields.length === 0) continue;

    rowsNeedingUpdate += 1;

    if (!apply) {
      console.log(
        `[dry-run] tenant=${row.tenantId} row=${row.id} fields=${plaintextFields.join(",")}`
      );
      continue;
    }

    updatePatch.updatedAt = new Date();

    await adminDb
      .update(tenantIntegrationSecrets)
      .set(updatePatch)
      .where(eq(tenantIntegrationSecrets.id, row.id));

    rowsUpdated += 1;
    console.log(
      `[updated] tenant=${row.tenantId} row=${row.id} fields=${plaintextFields.join(",")}`
    );
  }

  console.log("");
  console.log(`mode: ${apply ? "apply" : "dry-run"}`);
  console.log(`tenant filter: ${tenantId ?? "all"}`);
  console.log(`rows scanned: ${rowsScanned}`);
  console.log(`rows needing update: ${rowsNeedingUpdate}`);
  console.log(`rows updated: ${rowsUpdated}`);
  console.log(`plaintext fields found: ${plaintextFieldCount}`);
  console.log(`already encrypted fields: ${encryptedFieldCount}`);
  console.log(`empty fields: ${emptyFieldCount}`);
}

main()
  .catch((error) => {
    console.error("[backfill:tenant-secrets] failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
