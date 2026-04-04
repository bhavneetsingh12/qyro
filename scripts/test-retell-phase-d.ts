#!/usr/bin/env tsx

import { createHmac, randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { and, eq } from "drizzle-orm";
import {
  assistantSessions,
  appointments,
  callAttempts,
  closeDb,
  db,
  doNotContact,
  prospectsRaw,
  tenants,
} from "@qyro/db";

loadEnv({ path: ".env.local" });
loadEnv();

const API_BASE = process.env.API_BASE_URL ?? process.env.PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const RETELL_WEBHOOK_SECRET = String(process.env.RETELL_WEBHOOK_SECRET ?? "").trim();

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required");
if (!RETELL_WEBHOOK_SECRET) throw new Error("RETELL_WEBHOOK_SECRET is required");

let passed = 0;
let failed = 0;
let tenantId: string | null = null;

type Scenario = {
  id: string;
  title: string;
  verify: string;
};

const receptionistScripts: Scenario[] = [
  { id: "R1", title: "Natural greeting", verify: "Greeting is natural, concise, and business-specific" },
  { id: "R2", title: "First-turn barge-in", verify: "Caller interruption works without speaking over the caller" },
  { id: "R3", title: "FAQ answer", verify: "Business hours and approved services are answered correctly" },
  { id: "R4", title: "New booking", verify: "Appointment is created and persisted in QYRO" },
  { id: "R5", title: "Slot conflict", verify: "Unavailable slot is declined and alternate slot is suggested" },
  { id: "R6", title: "Escalation", verify: "Human handoff messaging is clear and escalation flag is persisted" },
  { id: "R7", title: "Do not contact", verify: "DND request ends politely and blocks future calls" },
  { id: "R8", title: "No-answer retry", verify: "Retry scheduling follows the configured backoff path" },
  { id: "R9", title: "Pause-resume guard", verify: "Paused tenant/global state still prevents outbound execution" },
  { id: "R10", title: "Wrong number privacy", verify: "Wrong-number path does not disclose extra business or customer data" },
];

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

function signRetellPayload(body: string) {
  return createHmac("sha256", RETELL_WEBHOOK_SECRET).update(body).digest("hex");
}

async function postRetell(path: string, payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-retell-signature": signRetellPayload(body),
    },
    body,
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  return { res, json, text };
}

async function cleanup() {
  if (!tenantId) return;

  await db.delete(doNotContact).where(eq(doNotContact.tenantId, tenantId)).catch(() => {});
  await db.delete(appointments).where(eq(appointments.tenantId, tenantId)).catch(() => {});
  await db.delete(callAttempts).where(eq(callAttempts.tenantId, tenantId)).catch(() => {});
  await db.delete(assistantSessions).where(eq(assistantSessions.tenantId, tenantId)).catch(() => {});
  await db.delete(prospectsRaw).where(eq(prospectsRaw.tenantId, tenantId)).catch(() => {});
  await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => {});
}

async function run() {
  console.log("\n════ Retell Phase D QA Harness ═══════════════════════════\n");

  const health = await fetch(`${API_BASE}/health`);
  assert(health.ok, "API health endpoint responds");

  const [tenant] = await db
    .insert(tenants)
    .values({
      name: "Retell Phase D Tenant",
      slug: `retell-phase-d-${Date.now()}`,
      plan: "agency",
      active: true,
      metadata: {
        tenant_type: "assistant",
        voice_runtime: "retell",
        retell_agent_id: "agent_phase_d_test",
        twilio_number: "+15035550199",
        widget_allowed_origins: ["http://localhost:3000"],
        approvedServices: "Consultation, follow-up",
        businessHours: "Mon-Fri 09:00-17:00",
        bookingLink: "https://example.com/book",
        autoRespond: true,
      },
    })
    .returning({ id: tenants.id, name: tenants.name });

  tenantId = tenant.id;
  pass("phase D tenant created");

  const [prospect] = await db
    .insert(prospectsRaw)
    .values({
      tenantId,
      source: "phase_d_test",
      businessName: "Phase D Prospect",
      phone: "+15035551234",
      email: "phase-d@example.com",
      consentState: "unknown",
    })
    .returning({ id: prospectsRaw.id });

  const [session] = await db
    .insert(assistantSessions)
    .values({
      tenantId,
      prospectId: prospect.id,
      sessionType: "voice_inbound",
      conversationHistory: [],
    })
    .returning({ id: assistantSessions.id });

  const [retryAttempt] = await db
    .insert(callAttempts)
    .values({
      tenantId,
      prospectId: prospect.id,
      direction: "outbound",
      status: "answered",
      outcome: "answered",
      attemptCount: 1,
      maxAttempts: 3,
      twilioCallSid: "retell-call-phase-d-retry",
    })
    .returning({ id: callAttempts.id });

  const incomingRes = await fetch(`${API_BASE}/api/v1/voice/incoming`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      To: "+15035550199",
      From: "+15035551234",
      CallSid: randomUUID(),
    }).toString(),
  });
  const incomingXml = await incomingRes.text();
  assert(incomingRes.ok, "voice incoming accepted for retell tenant", incomingXml);
  assert(incomingXml.includes("twilio-voice-webhook/agent_phase_d_test"), "voice incoming returns Retell redirect", incomingXml);

  const callEventPayload = {
    event_id: "phase-d-call-event-1",
    callAttemptId: retryAttempt.id,
    status: "no_answer",
    call: { id: "retell-call-phase-d-retry" },
  };
  const callEvent = await postRetell("/api/v1/retell/call-events", callEventPayload);
  assert(callEvent.res.ok, "retell call-event accepted", callEvent.json);

  const updatedRetryAttempt = await db.query.callAttempts.findFirst({ where: eq(callAttempts.id, retryAttempt.id) });
  assert(updatedRetryAttempt?.status === "retry_scheduled", "call-event schedules retry on no-answer", updatedRetryAttempt?.status);

  const duplicateCallEvent = await postRetell("/api/v1/retell/call-events", callEventPayload);
  assert(duplicateCallEvent.res.ok, "duplicate call-event request accepted safely", duplicateCallEvent.json);
  assert(Boolean((duplicateCallEvent.json as { duplicate?: boolean } | null)?.duplicate), "duplicate call-event is skipped", duplicateCallEvent.json);

  const transcriptEvent = await postRetell("/api/v1/retell/transcript-events", {
    event_id: "phase-d-transcript-1",
    sessionId: session.id,
    transcript: "I need to book an appointment for Tuesday morning.",
    speaker: "user",
  });
  assert(transcriptEvent.res.ok, "retell transcript-event accepted", transcriptEvent.json);

  const updatedSession = await db.query.assistantSessions.findFirst({ where: eq(assistantSessions.id, session.id) });
  const history = Array.isArray(updatedSession?.conversationHistory) ? updatedSession.conversationHistory : [];
  assert(history.length === 1, "transcript-event persisted conversation turn", history);

  const businessContext = await postRetell("/api/v1/retell/tools/get-business-context", {
    tenantId,
    sessionId: session.id,
  });
  assert(businessContext.res.ok, "business-context tool responds", businessContext.json);
  assert(
    String((businessContext.json as { data?: { businessName?: string } })?.data?.businessName ?? "") === tenant.name,
    "business-context returns correct tenant",
    businessContext.json,
  );

  const availability = await postRetell("/api/v1/retell/tools/check-availability", {
    tenantId,
    sessionId: session.id,
    startAt: "2026-04-10T17:00:00.000Z",
    endAt: "2026-04-10T17:30:00.000Z",
  });
  assert(availability.res.ok, "availability tool responds", availability.json);
  assert(Boolean((availability.json as { data?: { available?: boolean } })?.data?.available), "availability reports open slot", availability.json);

  const [bookingAttempt] = await db
    .insert(callAttempts)
    .values({
      tenantId,
      prospectId: prospect.id,
      direction: "inbound",
      status: "answered",
      outcome: "answered",
    })
    .returning({ id: callAttempts.id });

  const booking = await postRetell("/api/v1/retell/tools/create-booking", {
    tenantId,
    callAttemptId: bookingAttempt.id,
    sessionId: session.id,
    name: "Phase D Caller",
    email: "phase-d@example.com",
    startAt: "2026-04-10T17:00:00.000Z",
    endAt: "2026-04-10T17:30:00.000Z",
  });
  assert(booking.res.ok, "create-booking tool responds", booking.json);

  const storedAppointment = await db.query.appointments.findFirst({
    where: and(eq(appointments.tenantId, tenantId), eq(appointments.prospectId, prospect.id)),
  });
  assert(Boolean(storedAppointment), "create-booking persisted appointment");

  const escalated = await postRetell("/api/v1/retell/tools/escalate-to-human", {
    sessionId: session.id,
  });
  assert(escalated.res.ok, "escalate-to-human tool responds", escalated.json);

  const escalatedSession = await db.query.assistantSessions.findFirst({ where: eq(assistantSessions.id, session.id) });
  assert(escalatedSession?.escalated === true, "escalation flag persisted", escalatedSession?.escalated);

  const [dndAttempt] = await db
    .insert(callAttempts)
    .values({
      tenantId,
      prospectId: prospect.id,
      direction: "outbound",
      status: "queued",
      outcome: "queued",
    })
    .returning({ id: callAttempts.id });

  const dnd = await postRetell("/api/v1/retell/tools/mark-do-not-contact", {
    tenantId,
    callAttemptId: dndAttempt.id,
  });
  assert(dnd.res.ok, "mark-do-not-contact tool responds", dnd.json);

  const dndRecord = await db.query.doNotContact.findFirst({
    where: and(eq(doNotContact.tenantId, tenantId), eq(doNotContact.phone, "+15035551234")) as any,
  });
  assert(Boolean(dndRecord), "DND record persisted");

  const dndAttemptRow = await db.query.callAttempts.findFirst({ where: eq(callAttempts.id, dndAttempt.id) });
  assert(dndAttemptRow?.status === "dnd", "DND tool updates call attempt status", dndAttemptRow?.status);

  const [outcomeAttempt] = await db
    .insert(callAttempts)
    .values({
      tenantId,
      prospectId: prospect.id,
      direction: "outbound",
      status: "answered",
      outcome: "answered",
    })
    .returning({ id: callAttempts.id });

  const outcome = await postRetell("/api/v1/retell/tools/log-call-outcome", {
    callAttemptId: outcomeAttempt.id,
    status: "completed",
    duration: 93,
    recordingUrl: "https://example.com/recording.mp3",
    transcriptUrl: "https://example.com/transcript.json",
  });
  assert(outcome.res.ok, "log-call-outcome tool responds", outcome.json);

  const outcomeRow = await db.query.callAttempts.findFirst({ where: eq(callAttempts.id, outcomeAttempt.id) });
  assert(outcomeRow?.status === "completed", "call outcome persisted", outcomeRow?.status);

  console.log("\nReceptionist benchmark scripts to run live before rollout:\n");
  for (const scenario of receptionistScripts) {
    console.log(`  ${scenario.id}. ${scenario.title} — ${scenario.verify}`);
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