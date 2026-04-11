#!/usr/bin/env tsx

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  closeDb,
  tenants,
  prospectsRaw,
  callAttempts,
  doNotContact,
  deadLetterQueue,
  messageAttempts,
  appointments,
  assistantSessions,
  usageEvents,
} from "@qyro/db";
import { outboundCallQueue } from "@qyro/queue";
import { createOutboundCallWorker } from "../packages/queue/src/workers/outboundCallWorker";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3005";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required");

let tenantId: string | null = null;
let prospectId: string | null = null;
let attemptId: string | null = null;

let passed = 0;
let failed = 0;

function pass(label: string) {
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function fail(label: string, detail?: unknown) {
  failed += 1;
  console.error(`  ✗ ${label}`);
  if (detail !== undefined) console.error("    ", detail);
}

function assert(condition: boolean, label: string, detail?: unknown) {
  if (condition) pass(label);
  else fail(label, detail);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanup() {
  if (!tenantId) return;

  await db.delete(doNotContact).where(eq(doNotContact.tenantId, tenantId)).catch(() => {});
  await db.delete(deadLetterQueue).where(eq(deadLetterQueue.tenantId, tenantId)).catch(() => {});
  await db.delete(messageAttempts).where(eq(messageAttempts.tenantId, tenantId)).catch(() => {});
  await db.delete(appointments).where(eq(appointments.tenantId, tenantId)).catch(() => {});
  await db.delete(callAttempts).where(eq(callAttempts.tenantId, tenantId)).catch(() => {});
  await db.delete(assistantSessions).where(eq(assistantSessions.tenantId, tenantId)).catch(() => {});
  await db.delete(usageEvents).where(eq(usageEvents.tenantId, tenantId)).catch(() => {});
  await db.delete(prospectsRaw).where(eq(prospectsRaw.tenantId, tenantId)).catch(() => {});
  await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => {});
}

async function waitForStatus(targetAttemptId: string, timeoutMs = 12000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await db.query.callAttempts.findFirst({ where: eq(callAttempts.id, targetAttemptId) });
    const status = row?.status ?? null;
    if (status && status !== "queued" && status !== "dialing") return status;
    await sleep(500);
  }
  return null;
}

async function run() {
  console.log("\n════ Outbound Calls E2E ═════════════════════════════════\n");

  const worker = createOutboundCallWorker();

  try {
    // 1) Create tenant and prospect
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: "Outbound E2E Tenant",
        slug: `outbound-e2e-${Date.now()}`,
        plan: "agency",
        active: true,
        metadata: {
          tenant_type: "assistant",
          outbound_voice_enabled: true,
          voice_number: "+15035550199",
        },
      })
      .returning({ id: tenants.id });

    tenantId = tenant.id;
    assert(!!tenantId, "tenant created");

    const [prospect] = await db
      .insert(prospectsRaw)
      .values({
        tenantId,
        source: "manual_outbound",
        businessName: "Call Target",
        phone: "+15035551234",
        consentState: "unknown",
      })
      .returning({ id: prospectsRaw.id });

    prospectId = prospect.id;
    assert(!!prospectId, "prospect created");

    // 2) Queue outbound call attempt
    const [attempt] = await db
      .insert(callAttempts)
      .values({
        tenantId,
        prospectId,
        direction: "outbound",
        status: "queued",
        outcome: "queued",
        source: "lead_manual",
        attemptCount: 0,
        maxAttempts: 3,
      })
      .returning({ id: callAttempts.id });

    attemptId = attempt.id;
    assert(!!attemptId, "outbound call attempt created");

    await outboundCallQueue.add("outbound-call", { tenantId, callAttemptId: attemptId }, { jobId: `outbound-call:${attemptId}:1` });
    pass("outbound call job enqueued");

    // 3) Worker processes and sets retry/failure path
    const firstStatus = await waitForStatus(attemptId!);
    assert(
      firstStatus === "retry_scheduled" || firstStatus === "failed" || firstStatus === "blocked_compliance" || firstStatus === "ringing",
      "worker processed outbound call",
      firstStatus,
    );

    // 4) Simulate voice status callback (no-answer)
    const statusRes = await fetch(`${API_BASE}/api/v1/voice/status?callAttemptId=${encodeURIComponent(attemptId!)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        CallStatus: "no-answer",
        CallDuration: "0",
      }).toString(),
    });

    assert(statusRes.ok, "voice status callback accepted", await statusRes.text());

    const postStatus = await db.query.callAttempts.findFirst({ where: eq(callAttempts.id, attemptId) });
    assert(!!postStatus, "call attempt remains present after status callback");
    assert(postStatus?.status === "retry_scheduled" || postStatus?.status === "no_answer", "status updated after no-answer", postStatus?.status);

    // 5) Simulate DND phrase in voice turn
    const dndRes = await fetch(`${API_BASE}/api/v1/voice/turn?callAttemptId=${encodeURIComponent(attemptId!)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        SpeechResult: "Please stop calling me",
      }).toString(),
    });

    const dndXml = await dndRes.text();
    assert(dndRes.ok, "voice turn accepted dnd response", dndXml);
    assert(dndXml.toLowerCase().includes("will not call you again"), "dnd response returned in twiml", dndXml);

    const dndRow = await db.query.doNotContact.findFirst({
      where: and(eq(doNotContact.tenantId, tenantId), eq(doNotContact.phone, "+15035551234")) as any,
    });
    assert(!!dndRow, "dnd record created");

    const finalAttempt = await db.query.callAttempts.findFirst({ where: eq(callAttempts.id, attemptId) });
    assert(finalAttempt?.status === "dnd", "call attempt status set to dnd", finalAttempt?.status);
  } finally {
    await worker.close();
  }
}

run()
  .catch((err) => {
    console.error("[ERROR]", err);
    failed += 1;
  })
  .finally(async () => {
    await cleanup();
    await closeDb().catch(() => {});

    console.log("\n════ Results ═══════════════════════════════════════════");
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    console.log("══════════════════════════════════════════════════════════\n");

    process.exit(failed > 0 ? 1 : 0);
  });
