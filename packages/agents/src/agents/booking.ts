// QYRO Booking Agent
// See docs/AGENTS.md for contract rules.
//
// MUST NOT: double-book, book outside availability, book without confirming prospect identity
// Model:    standard (gpt-4o) — reliable slot parsing from natural language
// Input:    tenantId, prospectId, calendarId, requestText
// Output:   { appointmentId, slot, confirmationSent } | { skipped, skipReason }

import { db } from "@qyro/db";
import { prospectsRaw, appointments } from "@qyro/db";
import { eq, and } from "drizzle-orm";
import { runStructuredCompletion, type AgentResult } from "../runner";
import { type AgentName } from "../budget";

const AGENT: AgentName = "booking";
const CAL_API_BASE     = "https://api.cal.com/v1";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type BookingInput = {
  tenantId:    string;
  prospectId:  string;
  calendarId:  string;
  requestText: string;
  runId?:      string;
};

export type BookingOutput = {
  skipped:          false;
  appointmentId:    string;
  slot:             string;   // ISO datetime
  confirmationSent: boolean;
} | {
  skipped:    true;
  skipReason: string;
};

type SlotParsed = {
  preferredDate:    string;  // ISO date e.g. "2026-04-01"
  preferredTime:    string;  // 24h e.g. "14:00"
  flexibilityHours: number;
};

type CalSlot = {
  startTime: string;  // ISO datetime
};

// ─── Cal.com: fetch available slots ───────────────────────────────────────────

async function fetchAvailableSlots(calendarId: string): Promise<CalSlot[]> {
  const apiKey = process.env.CAL_API_KEY;
  if (!apiKey) throw new Error("CAL_API_KEY is not set");

  const dateFrom = new Date().toISOString();
  const dateTo   = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const url = new URL(`${CAL_API_BASE}/slots`);
  url.searchParams.set("apiKey",      apiKey);
  url.searchParams.set("eventTypeId", calendarId);
  url.searchParams.set("startTime",   dateFrom);
  url.searchParams.set("endTime",     dateTo);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Cal.com slots ${res.status}`);

  const data = await res.json() as { slots: Record<string, { time: string }[]> };
  return Object.values(data.slots ?? {})
    .flat()
    .map((s) => ({ startTime: s.time }));
}

// ─── Cal.com: create booking ───────────────────────────────────────────────────

async function createCalBooking(params: {
  calendarId: string;
  startTime:  string;
  name:       string;
  email:      string;
}): Promise<string> {  // returns booking uid
  const apiKey = process.env.CAL_API_KEY;
  if (!apiKey) throw new Error("CAL_API_KEY is not set");

  const res = await fetch(`${CAL_API_BASE}/bookings?apiKey=${apiKey}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventTypeId: params.calendarId,
      start:       params.startTime,
      responses: {
        name:  params.name,
        email: params.email,
      },
      timeZone: process.env.DEFAULT_TIMEZONE ?? "America/Los_Angeles",
      language: "en",
    }),
  });

  if (!res.ok) throw new Error(`Cal.com booking ${res.status}`);
  const data = await res.json() as { uid: string };
  return data.uid;
}

// ─── LLM: parse natural language time request ──────────────────────────────────

const SLOT_SYSTEM = `You are a scheduling assistant. Given a natural language time request and today's date, parse it into structured JSON.
Return ONLY valid JSON — no markdown, no explanation:
{
  "preferredDate":    string,  // ISO date e.g. "2026-04-01" — use nearest match
  "preferredTime":    string,  // 24h format e.g. "14:00"; default "10:00" if vague
  "flexibilityHours": number   // how many hours either side is acceptable; default 2
}`;

async function parseTimeRequest(
  tenantId:    string,
  requestText: string,
  runId?:      string,
): Promise<AgentResult<SlotParsed>> {
  const today = new Date().toISOString().slice(0, 10);

  return runStructuredCompletion<SlotParsed>(
    { tenantId, agentName: AGENT, runId },
    [{ role: "user", content: `Today: ${today}\nRequest: "${requestText}"` }],
    SLOT_SYSTEM,
  );
}

// ─── Pick best matching slot ───────────────────────────────────────────────────

function pickBestSlot(slots: CalSlot[], parsed: SlotParsed): CalSlot | null {
  if (slots.length === 0) return null;

  const target    = new Date(`${parsed.preferredDate}T${parsed.preferredTime}:00`);
  const windowMs  = parsed.flexibilityHours * 60 * 60 * 1000;

  const candidates = slots.filter(
    (s) => Math.abs(new Date(s.startTime).getTime() - target.getTime()) <= windowMs,
  );

  const pool = candidates.length > 0 ? candidates : slots;

  return pool.reduce((best, s) =>
    Math.abs(new Date(s.startTime).getTime() - target.getTime()) <
    Math.abs(new Date(best.startTime).getTime() - target.getTime())
      ? s : best,
  );
}

// ─── Main agent function ───────────────────────────────────────────────────────

export async function runBooking(
  input: BookingInput,
): Promise<AgentResult<BookingOutput>> {
  const { tenantId, prospectId, calendarId, requestText, runId } = input;

  // 1. Load prospect — identity must be confirmed before booking
  const prospect = await db.query.prospectsRaw.findFirst({
    where: and(
      eq(prospectsRaw.tenantId, tenantId),
      eq(prospectsRaw.id, prospectId),
    ),
  });

  if (!prospect) {
    return { ok: false, error: { code: "INVALID_INPUT", message: `Prospect not found: ${prospectId}` } };
  }

  if (!prospect.email) {
    return {
      ok:    true,
      data:  { skipped: true, skipReason: "no_email" },
      usage: { inputTokens: 0, outputTokens: 0, model: "none", modelTier: "standard", cached: false },
    };
  }

  // 2. Fetch available slots from Cal.com
  let availableSlots: CalSlot[];
  try {
    availableSlots = await fetchAvailableSlots(calendarId);
  } catch (err) {
    return { ok: false, error: { code: "EXTERNAL_API_ERROR", message: String(err) } };
  }

  if (availableSlots.length === 0) {
    return {
      ok:    true,
      data:  { skipped: true, skipReason: "no_slots_available" },
      usage: { inputTokens: 0, outputTokens: 0, model: "none", modelTier: "standard", cached: false },
    };
  }

  // 3. Parse natural language time request
  const parseResult = await parseTimeRequest(tenantId, requestText, runId);
  if (!parseResult.ok) return parseResult;

  // 4. Match to best available slot
  const slot = pickBestSlot(availableSlots, parseResult.data);
  if (!slot) {
    return {
      ok:    true,
      data:  { skipped: true, skipReason: "no_matching_slot" },
      usage: parseResult.usage,
    };
  }

  // 5. Create booking in Cal.com
  let calBookingUid: string;
  try {
    calBookingUid = await createCalBooking({
      calendarId,
      startTime: slot.startTime,
      name:      prospect.businessName,
      email:     prospect.email,
    });
  } catch (err) {
    return { ok: false, error: { code: "EXTERNAL_API_ERROR", message: String(err) } };
  }

  // 6. Write to appointments table (15-minute slot default)
  const startAt = new Date(slot.startTime);
  const endAt   = new Date(startAt.getTime() + 15 * 60 * 1000);

  const [appt] = await db
    .insert(appointments)
    .values({
      tenantId,
      prospectId,
      calBookingUid,
      startAt,
      endAt,
      status: "confirmed",
    })
    .returning({ id: appointments.id });

  return {
    ok:   true,
    data: {
      skipped:          false,
      appointmentId:    appt.id,
      slot:             slot.startTime,
      confirmationSent: true,  // Cal.com sends confirmation emails natively
    },
    usage: parseResult.usage,
  };
}
