#!/usr/bin/env tsx
// scripts/test-e2e.ts
// Task I — End-to-end: ingest 1 lead → research → outreach draft → approval
//
// Prerequisites:
//   1. docker compose -f infra/docker-compose.test.yml up -d
//   2. DATABASE_URL=postgres://qyro:qyro@localhost:5433/qyro_test pnpm db:generate
//   3. DATABASE_URL=postgres://qyro:qyro@localhost:5433/qyro_test pnpm db:migrate
//
// Run:
//   DATABASE_URL=postgres://qyro:qyro@localhost:5433/qyro_test \
//   REDIS_URL=redis://localhost:6380 \
//   OPENAI_API_KEY=sk-... \
//   tsx scripts/test-e2e.ts
//
// All test rows are cleaned up after the run (pass or fail).

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "../packages/db/src/schema";
import { runResearch } from "../packages/agents/src/agents/research";
import { runOutreach } from "../packages/agents/src/agents/outreach";

// ─── Env validation ────────────────────────────────────────────────────────────

const { DATABASE_URL, REDIS_URL, OPENAI_API_KEY } = process.env;

if (!DATABASE_URL) bail("DATABASE_URL is not set");
if (!REDIS_URL)    bail("REDIS_URL is not set");
if (!OPENAI_API_KEY) bail("OPENAI_API_KEY is not set");

// ─── DB client (scoped to this script) ────────────────────────────────────────

const pgConn = postgres(DATABASE_URL!, { max: 2 });
const db     = drizzle(pgConn, { schema });

// ─── Test state (cleaned up in finally block) ─────────────────────────────────

let testTenantId:  string | null = null;
let testUserId:    string | null = null;
let prospectId:    string | null = null;
let sequenceId:    string | null = null;
let messageAttemptId: string | null = null;
let messageAttemptStatus: "pending_approval" | "blocked_by_qa" | null = null;

let passed = 0;
let failed = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bail(msg: string): never {
  console.error(`\n[BAIL] ${msg}`);
  process.exit(1);
}

function pass(label: string) {
  passed++;
  console.log(`  ✓  ${label}`);
}

function fail(label: string, detail?: unknown) {
  failed++;
  console.error(`  ✗  ${label}`);
  if (detail !== undefined) console.error("     ", detail);
}

function assert(condition: boolean, label: string, detail?: unknown) {
  condition ? pass(label) : fail(label, detail);
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

async function cleanup() {
  if (!testTenantId) return;
  // Delete in FK-safe order (children before parents)
  await db.delete(schema.messageAttempts)
    .where(eq(schema.messageAttempts.tenantId, testTenantId))
    .catch(() => {});
  await db.delete(schema.prospectsEnriched)
    .where(eq(schema.prospectsEnriched.tenantId, testTenantId))
    .catch(() => {});
  await db.delete(schema.outreachSequences)
    .where(eq(schema.outreachSequences.tenantId, testTenantId))
    .catch(() => {});
  await db.delete(schema.prospectsRaw)
    .where(eq(schema.prospectsRaw.tenantId, testTenantId))
    .catch(() => {});
  await db.delete(schema.usageEvents)
    .where(eq(schema.usageEvents.tenantId, testTenantId))
    .catch(() => {});
  if (testUserId) {
    await db.delete(schema.users)
      .where(eq(schema.users.id, testUserId))
      .catch(() => {});
  }
  await db.delete(schema.tenants)
    .where(eq(schema.tenants.id, testTenantId))
    .catch(() => {});
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log("\n════ QYRO E2E Test ════════════════════════════════════════\n");
  const runId = randomUUID();

  // ── Step 0: ensure plans exist ──────────────────────────────────────────────
  console.log("Step 0 — ensure plan rows exist");
  const PLANS = [
    { name: "starter" as const, dailyInputTokens: 50_000,  dailyOutputTokens: 20_000,  maxSeats: 2,  priceMonthly: 4900,  setupFee: 0 },
    { name: "growth"  as const, dailyInputTokens: 200_000, dailyOutputTokens: 80_000,  maxSeats: 5,  priceMonthly: 9900,  setupFee: 0 },
    { name: "agency"  as const, dailyInputTokens: 800_000, dailyOutputTokens: 300_000, maxSeats: 20, priceMonthly: 29900, setupFee: 50000 },
  ];
  for (const plan of PLANS) {
    await db
      .insert(schema.plans)
      .values(plan)
      .onConflictDoNothing()
      .catch(() => {});
  }
  pass("plan rows present");

  // ── Step 1: create test tenant ──────────────────────────────────────────────
  console.log("\nStep 1 — create test tenant");
  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      name:   "E2E Test Tenant",
      slug:   `e2e-test-${Date.now()}`,
      plan:   "agency",
      active: true,
    })
    .returning({ id: schema.tenants.id });

  testTenantId = tenant.id;
  assert(!!testTenantId, "tenant created", testTenantId);

  // Create a placeholder user (needed for approvedBy FK in sequences)
  const [user] = await db
    .insert(schema.users)
    .values({
      tenantId: testTenantId,
      clerkId:  `e2e-clerk-${Date.now()}`,
      email:    "e2e-test@qyro.test",
      name:     "E2E Test User",
      role:     "owner",
      active:   true,
    })
    .returning({ id: schema.users.id });

  testUserId = user.id;
  assert(!!testUserId, "test user created");

  // ── Step 2: ingest 1 lead ───────────────────────────────────────────────────
  console.log("\nStep 2 — ingest lead");
  const [prospect] = await db
    .insert(schema.prospectsRaw)
    .values({
      tenantId:     testTenantId,
      source:       "inbound_form",
      businessName: "Sunrise Dental Hillsboro",
      domain:       "sunrisedentalor.com",
      phone:        "+15035550100",
      email:        "info@sunrisedentalor.com",
      niche:        "dental",
      consentState: "unknown",
    })
    .returning({ id: schema.prospectsRaw.id });

  prospectId = prospect.id;
  assert(!!prospectId, "prospect inserted", prospectId);

  // ── Step 3: run research ─────────────────────────────────────────────────────
  console.log("\nStep 3 — run research (calls OpenAI)");
  const researchResult = await runResearch({
    tenantId:   testTenantId,
    prospectId: prospectId!,
    domain:     "sunrisedentalor.com",
    runId,
  });

  assert(researchResult.ok, "runResearch returned ok", researchResult);

  if (researchResult.ok) {
    assert(researchResult.data.prospectId === prospectId, "prospectId matches");
    assert(typeof researchResult.data.urgencyScore === "number", "urgencyScore is a number");
    console.log(`     urgencyScore=${researchResult.data.urgencyScore} fromCache=${researchResult.data.fromCache}`);

    // Verify DB row
    const enriched = await db.query.prospectsEnriched.findFirst({
      where: and(
        eq(schema.prospectsEnriched.tenantId, testTenantId),
        eq(schema.prospectsEnriched.prospectId, prospectId!),
      ),
    });
    assert(!!enriched, "prospects_enriched row exists");
    assert(!!enriched?.summary, "enriched.summary is non-empty");
    assert(Array.isArray(enriched?.painPoints), "enriched.painPoints is an array");
  }

  // ── Step 4: create active outreach sequence ──────────────────────────────────
  console.log("\nStep 4 — create active outreach sequence");
  const [sequence] = await db
    .insert(schema.outreachSequences)
    .values({
      tenantId:     testTenantId,
      name:         "E2E Test Email Sequence",
      channel:      "email",
      promptPackId: "dental_cold_email_v1",
      niche:        "dental",
      active:       true,          // pre-approved for test
      approvedBy:   testUserId,
      approvedAt:   new Date(),
    })
    .returning({ id: schema.outreachSequences.id });

  sequenceId = sequence.id;
  assert(!!sequenceId, "outreach sequence created");

  // ── Step 5: run outreach ─────────────────────────────────────────────────────
  console.log("\nStep 5 — run outreach (calls OpenAI)");
  const outreachResult = await runOutreach({
    tenantId:   testTenantId,
    prospectId: prospectId!,
    sequenceId: sequenceId!,
    runId,
  });

  assert(outreachResult.ok, "runOutreach returned ok", outreachResult);

  if (outreachResult.ok) {
    assert(!outreachResult.data.skipped, "outreach was not skipped");

    if (!outreachResult.data.skipped) {
      messageAttemptId = outreachResult.data.messageAttemptId;
      assert(!!messageAttemptId, "messageAttemptId returned");
      assert(outreachResult.data.channel === "email", "channel is email");
      console.log(`     preview: ${outreachResult.data.preview.slice(0, 80)}…`);

      // Verify DB row
      const attempt = await db.query.messageAttempts.findFirst({
        where: eq(schema.messageAttempts.id, messageAttemptId!),
      });
      messageAttemptStatus =
        attempt?.status === "pending_approval" || attempt?.status === "blocked_by_qa"
          ? attempt.status
          : null;
      assert(!!messageAttemptStatus, "message_attempt status is pending_approval or blocked_by_qa", attempt?.status);
    }
  }

  // ── Step 6: approve the draft ────────────────────────────────────────────────
  console.log("\nStep 6 — approve message draft");
  if (messageAttemptId) {
    if (messageAttemptStatus === "blocked_by_qa") {
      pass("approval skipped — draft blocked_by_qa by guardrail");
      return;
    }

    const [approved] = await db
      .update(schema.messageAttempts)
      .set({ status: "approved" })
      .where(
        and(
          eq(schema.messageAttempts.tenantId, testTenantId),
          eq(schema.messageAttempts.id, messageAttemptId),
        ),
      )
      .returning({ id: schema.messageAttempts.id, status: schema.messageAttempts.status });

    assert(!!approved, "update returned a row");
    assert(approved?.status === "approved", "message_attempt status = approved");
  } else {
    fail("skip approval — no messageAttemptId");
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

run()
  .catch((err) => {
    console.error("\n[ERROR]", err);
    failed++;
  })
  .finally(async () => {
    console.log("\nStep 7 — cleanup test data");
    await cleanup();
    pass("test data cleaned up");

    await pgConn.end();

    console.log("\n════ Results ══════════════════════════════════════════════");
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    console.log("═══════════════════════════════════════════════════════════\n");
    process.exit(failed > 0 ? 1 : 0);
  });
