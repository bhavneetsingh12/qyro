// QYRO Internal Tenant Seed
// Seeds Bhavneet's "internal" tenant + owner user.
// Run once: npx tsx infra/seed.ts
// Safe to re-run — upserts on slug / clerk_id.

import { config } from "dotenv";
// Load .env.local first (gitignored), then .env as fallback
config({ path: ".env.local" });
config();
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as schema from "../packages/db/src/schema";

// ─── Validate env ─────────────────────────────────────────────────────────────

const { DATABASE_URL, SEED_CLERK_USER_ID } = process.env;

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set. Copy .env.example → .env.local and fill it in.");
  process.exit(1);
}
if (!SEED_CLERK_USER_ID) {
  console.error("ERROR: SEED_CLERK_USER_ID is not set. Get your Clerk user ID from the Clerk dashboard.");
  process.exit(1);
}

// ─── DB client (no RLS — seed runs as superuser) ─────────────────────────────

const client = postgres(DATABASE_URL, { max: 1 });
const db  = drizzle(client, { schema });

// ─── Seed data ────────────────────────────────────────────────────────────────

const INTERNAL_TENANT = {
  name:   "Bhavneet Singh — Zentryx LLC",
  slug:   "bhavneet-internal",
  plan:   "agency" as const,   // internal tenant gets agency limits
  active: true,
  metadata: {
    tenant_type:  "internal",
    owner:        "bhavneet@zentryxllc.com",
    product:      "qyro_lead",
    phase:        1,
    note:         "Bhavneet's internal QYRO Lead tenant. Single-tenant Phase 1.",
  },
};

const OWNER_USER = {
  id:      crypto.randomUUID(),
  clerkId: SEED_CLERK_USER_ID,
  email:   "bhavneet@zentryxllc.com",
  name:    "Bhavneet Singh",
  role:    "owner" as const,
  active:  true,
};

const PLANS = [
  { name: "starter" as const, dailyInputTokens: 50_000,  dailyOutputTokens: 20_000,  maxSeats: 2,  priceMonthly: 4900,  setupFee: 0    },
  { name: "growth"  as const, dailyInputTokens: 200_000, dailyOutputTokens: 80_000,  maxSeats: 5,  priceMonthly: 9900,  setupFee: 0    },
  { name: "agency"  as const, dailyInputTokens: 800_000, dailyOutputTokens: 300_000, maxSeats: 20, priceMonthly: 29900, setupFee: 50000 },
];

// ─── Run seed ─────────────────────────────────────────────────────────────────

async function seed() {
  console.log("─── QYRO Seed ───────────────────────────────────────");

  // 1. Upsert plan definitions
  console.log("1/3  Upserting plans...");
  for (const plan of PLANS) {
    const existing = await db.select().from(schema.plans)
      .where(eq(schema.plans.name, plan.name))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(schema.plans).values(plan);
      console.log(`     Created plan: ${plan.name}`);
    } else {
      await db.update(schema.plans)
        .set({ dailyInputTokens: plan.dailyInputTokens, dailyOutputTokens: plan.dailyOutputTokens, maxSeats: plan.maxSeats, priceMonthly: plan.priceMonthly, setupFee: plan.setupFee })
        .where(eq(schema.plans.name, plan.name));
      console.log(`     Updated plan: ${plan.name}`);
    }
  }

  // 2. Upsert internal tenant
  console.log("2/3  Upserting internal tenant...");
  const existingTenant = await db.select().from(schema.tenants)
    .where(eq(schema.tenants.slug, INTERNAL_TENANT.slug))
    .limit(1);

  let tenantId: string;
  if (existingTenant.length === 0) {
    const [newTenant] = await db.insert(schema.tenants)
      .values(INTERNAL_TENANT)
      .returning({ id: schema.tenants.id });
    tenantId = newTenant.id;
    console.log(`     Created tenant: ${INTERNAL_TENANT.slug} (${tenantId})`);
  } else {
    tenantId = existingTenant[0].id;
    await db.update(schema.tenants)
      .set({ name: INTERNAL_TENANT.name, plan: INTERNAL_TENANT.plan, metadata: INTERNAL_TENANT.metadata, updatedAt: new Date() })
      .where(eq(schema.tenants.slug, INTERNAL_TENANT.slug));
    console.log(`     Updated tenant: ${INTERNAL_TENANT.slug} (${tenantId})`);
  }

  // 3. Upsert owner user (raw SQL — Drizzle enum OID bug on postgres-js)
  console.log("3/3  Upserting owner user...");
  const existingUserRows = await client.unsafe(
    `SELECT id FROM users WHERE clerk_id = '${OWNER_USER.clerkId}' LIMIT 1`
  );

  if (existingUserRows.length === 0) {
  await client.unsafe(`
    INSERT INTO users (id, tenant_id, clerk_id, email, name, role, active)
    VALUES (
      '${OWNER_USER.id}', '${tenantId}', '${OWNER_USER.clerkId}',
      '${OWNER_USER.email}', '${OWNER_USER.name}', 'owner', true
    )
  `);
  console.log(`     Created owner user: ${OWNER_USER.email} (${OWNER_USER.id})`);

 } else {
    await client.unsafe(`
      UPDATE users SET
        tenant_id = '${tenantId}',
        email = '${OWNER_USER.email}',
        name = '${OWNER_USER.name}'
      WHERE clerk_id = '${OWNER_USER.clerkId}'
    `);
    console.log(`     Updated owner user: ${OWNER_USER.email}`);
  }

  console.log("─── Seed complete ───────────────────────────────────");
  console.log(`    tenant_id: ${tenantId}`);
  console.log("    Copy tenant_id above into .env.local as INTERNAL_TENANT_ID");
}

seed()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => client.end());
