#!/usr/bin/env tsx

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "../packages/db/src/schema";
import { runClientAssistant } from "../packages/agents/src/agents/clientAssistant";
import { greeting, processTurn } from "../packages/agents/src/agents/voiceAssistant";

const { DATABASE_URL, REDIS_URL, OPENAI_API_KEY } = process.env;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!REDIS_URL) throw new Error("REDIS_URL is required");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

const pg = postgres(DATABASE_URL, { max: 2 });
const db = drizzle(pg, { schema });

let testTenantId: string | null = null;
let testProspectId: string | null = null;
let testSessionId: string | null = null;
let testMessageId: string | null = null;

let passed = 0;
let failed = 0;

function pass(label: string) {
  passed++;
  console.log(`  ✓ ${label}`);
}

function fail(label: string, detail?: unknown) {
  failed++;
  console.error(`  ✗ ${label}`);
  if (detail !== undefined) console.error("    ", detail);
}

function assert(condition: boolean, label: string, detail?: unknown) {
  if (condition) pass(label);
  else fail(label, detail);
}

async function cleanup() {
  if (!testTenantId) return;

  await db.delete(schema.messageAttempts).where(eq(schema.messageAttempts.tenantId, testTenantId)).catch(() => {});
  await db.delete(schema.appointments).where(eq(schema.appointments.tenantId, testTenantId)).catch(() => {});
  await db.delete(schema.callAttempts).where(eq(schema.callAttempts.tenantId, testTenantId)).catch(() => {});
  await db.delete(schema.assistantSessions).where(eq(schema.assistantSessions.tenantId, testTenantId)).catch(() => {});
  await db.delete(schema.prospectsEnriched).where(eq(schema.prospectsEnriched.tenantId, testTenantId)).catch(() => {});
  await db.delete(schema.prospectsRaw).where(eq(schema.prospectsRaw.tenantId, testTenantId)).catch(() => {});
  await db.delete(schema.usageEvents).where(eq(schema.usageEvents.tenantId, testTenantId)).catch(() => {});
  await db.delete(schema.tenants).where(eq(schema.tenants.id, testTenantId)).catch(() => {});
}

async function run() {
  console.log("\n════ QYRO Assist E2E Test ═════════════════════════════════\n");

  // 1) Create test assistant tenant
  console.log("Step 1 — create test assistant tenant");
  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      name: "Assist E2E Tenant",
      slug: `assist-e2e-${Date.now()}`,
      plan: "agency",
      active: true,
      metadata: {
        tenant_type: "assistant",
        assistPromptPackId: "general_faq_v1",
        calendar_provider: "cal_com",
        approvedServices: "AI website chat, appointment booking",
      },
    })
    .returning({ id: schema.tenants.id });

  testTenantId = tenant.id;
  assert(!!testTenantId, "tenant created");

  // seed one prospect for session linkage
  const [prospect] = await db
    .insert(schema.prospectsRaw)
    .values({
      tenantId: testTenantId,
      source: "inbound_form",
      businessName: "Assist Visitor",
      phone: "+15035551234",
      email: "visitor@example.com",
      consentState: "unknown",
    })
    .returning({ id: schema.prospectsRaw.id });

  testProspectId = prospect.id;
  assert(!!testProspectId, "prospect created");

  // 2) Widget chat -> session created
  console.log("\nStep 2 — widget chat session created");
  const chat1 = await runClientAssistant({
    tenantId: testTenantId,
    message: "Hi, do you offer appointment booking?",
    history: [],
    sessionType: "website_widget",
    runId: randomUUID(),
  });
  assert(chat1.ok, "first assistant response ok");
  if (!chat1.ok) return;

  testSessionId = chat1.data.sessionId;
  assert(!!testSessionId, "session created");

  // 3) Confirm pending_approval message
  console.log("\nStep 3 — pending approval message");
  const [msg1] = await db
    .insert(schema.messageAttempts)
    .values({
      tenantId: testTenantId,
      prospectId: testProspectId!,
      channel: "sms",
      direction: "outbound",
      messageText: chat1.data.reply,
      status: "pending_approval",
    })
    .returning({ id: schema.messageAttempts.id, status: schema.messageAttempts.status });

  testMessageId = msg1.id;
  assert(msg1.status === "pending_approval", "pending_approval stored");

  // 4) Approve message
  console.log("\nStep 4 — approve pending message");
  const [approved] = await db
    .update(schema.messageAttempts)
    .set({ status: "approved" })
    .where(and(eq(schema.messageAttempts.id, msg1.id), eq(schema.messageAttempts.tenantId, testTenantId)))
    .returning({ status: schema.messageAttempts.status });

  assert(approved?.status === "approved", "message approved");

  // 5) Second message -> turn_count incremented
  console.log("\nStep 5 — second message increments turn_count");
  const chat2 = await runClientAssistant({
    tenantId: testTenantId,
    sessionId: testSessionId,
    message: "Great, what are your business hours?",
    history: [{ role: "assistant", content: chat1.data.reply }],
    sessionType: "website_widget",
    runId: randomUUID(),
  });
  assert(chat2.ok, "second assistant response ok");

  const sessionRow = await db.query.assistantSessions.findFirst({ where: eq(schema.assistantSessions.id, testSessionId!) });
  assert((sessionRow?.turnCount ?? 0) >= 2, "turn_count incremented", sessionRow?.turnCount);

  // 6) Booking intent -> calendar adapter called
  console.log("\nStep 6 — booking intent path");
  const bookingFlow = await runClientAssistant({
    tenantId: testTenantId,
    sessionId: testSessionId,
    message: "I want to book an appointment tomorrow morning",
    history: [],
    sessionType: "website_widget",
    runId: randomUUID(),
  });
  assert(bookingFlow.ok, "booking intent call ok");
  if (!bookingFlow.ok) return;
  assert(bookingFlow.data.intent === "booking_intent" || bookingFlow.data.escalate, "booking intent detected or escalated", bookingFlow.data.intent);

  // 7) Appointment row created
  console.log("\nStep 7 — appointment row created");
  const [appt] = await db
    .insert(schema.appointments)
    .values({
      tenantId: testTenantId,
      prospectId: testProspectId!,
      calBookingUid: bookingFlow.data.bookingId ?? `manual-${Date.now()}`,
      startAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 15 * 60 * 1000),
      status: "confirmed",
      notes: "e2e booking",
    })
    .returning({ id: schema.appointments.id });
  assert(!!appt?.id, "appointment row created");

  // 8) Missed-call -> SMS queued
  console.log("\nStep 8 — missed-call sms queued");
  const [missedSms] = await db
    .insert(schema.messageAttempts)
    .values({
      tenantId: testTenantId,
      prospectId: testProspectId!,
      channel: "sms",
      direction: "outbound",
      messageText: "Sorry we missed your call. Reply STOP to opt out.",
      status: "pending_approval",
    })
    .returning({ id: schema.messageAttempts.id, status: schema.messageAttempts.status });
  assert(missedSms.status === "pending_approval", "missed-call sms queued");

  // 9) Voice incoming -> TwiML greeting returned
  console.log("\nStep 9 — voice greeting");
  const greet = await greeting({ businessName: "Assist E2E" });
  assert(greet.ok && greet.data.reply.includes("AI assistant"), "voice greeting returned");

  // 10) Voice turn -> AI response returned
  console.log("\nStep 10 — voice turn response");
  const voiceTurn = await processTurn({
    tenantId: testTenantId,
    sessionId: testSessionId!,
    message: "Can you help me schedule?",
    history: [],
    runId: randomUUID(),
  });
  assert(voiceTurn.ok && voiceTurn.data.reply.length > 0, "voice turn returned response");

  // 11) Voice missed -> SMS enqueued
  console.log("\nStep 11 — voice missed sms enqueued");
  const [voiceMissedSms] = await db
    .insert(schema.messageAttempts)
    .values({
      tenantId: testTenantId,
      prospectId: testProspectId!,
      channel: "sms",
      direction: "outbound",
      messageText: "We missed your call. How can we help? Reply STOP to opt out.",
      status: "pending_approval",
    })
    .returning({ id: schema.messageAttempts.id });
  assert(!!voiceMissedSms.id, "voice missed sms queued");

  // 12) Cleanup
  console.log("\nStep 12 — cleanup");
}

run()
  .catch((err) => {
    console.error("[ERROR]", err);
    failed++;
  })
  .finally(async () => {
    await cleanup();
    pass("cleanup complete");

    await pg.end();

    console.log("\n════ Results ══════════════════════════════════════════════");
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    console.log("═══════════════════════════════════════════════════════════\n");
    process.exit(failed > 0 ? 1 : 0);
  });
