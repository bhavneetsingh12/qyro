import express, { Router, type Request, type Response, type NextFunction, type Router as ExpressRouter } from "express";
import { db } from "@qyro/db";
import { assistantSessions, callAttempts, prospectsRaw, tenants, doNotContact, tenantSubscriptions } from "@qyro/db";
import { and, desc, eq, or } from "drizzle-orm";
import { greeting, processTurn, transferToStaff } from "@qyro/agents/voiceAssistant";
import { compactHistory, shouldCompact } from "@qyro/agents/compact";
import { outboundCallQueue, publishRealtimeEvent, webhookQueue } from "@qyro/queue";
import { resolveTenantBaseAccess, resolveTrialState } from "../lib/entitlements";
import { triggerEscalationNotifications } from "../lib/escalation";

const router: ExpressRouter = Router();
router.use(express.urlencoded({ extended: true }));

function twimlSay(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${text}</Say></Response>`;
}

function twimlDial(to: string, sayFirst?: string): string {
  const say = sayFirst ? `<Say>${sayFirst}</Say>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Dial>${to}</Dial></Response>`;
}

function twimlGatherAndSay(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" action="/api/v1/voice/turn" method="POST" speechTimeout="auto"><Say>${text}</Say></Gather><Say>We did not hear a response. Please call back if you still need help.</Say></Response>`;
}

function twimlGatherAndSayWithAction(actionUrl: string, text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" action="${actionUrl}" method="POST" speechTimeout="auto"><Say>${text}</Say></Gather><Say>We did not hear a response. Please call back if you still need help.</Say></Response>`;
}

function twimlEmpty(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

function normalizePhone(value?: string): string {
  return (value ?? "").replace(/[^+\d]/g, "").trim();
}

function isDndRequest(text: string): boolean {
  const lowered = text.toLowerCase();
  return /\b(stop|unsubscribe|do not call|dont call|don't call|remove me|opt out|dnd)\b/.test(lowered);
}

function getVoiceRuntime(metaRaw: unknown): "retell" | "twilio" {
  const meta = metaRaw && typeof metaRaw === "object" ? (metaRaw as Record<string, unknown>) : {};
  const raw = String(meta.voice_runtime ?? "twilio").trim().toLowerCase();
  return raw === "retell" ? "retell" : "twilio";
}

function getRetellAgentId(metaRaw: unknown): string {
  const meta = metaRaw && typeof metaRaw === "object" ? (metaRaw as Record<string, unknown>) : {};
  const fromMeta = String(meta.retell_agent_id ?? "").trim();
  if (fromMeta) return fromMeta;
  return String(process.env.RETELL_AGENT_ID_DEFAULT ?? "").trim();
}

function twimlRetellRedirect(agentId: string): string {
  const base = String(process.env.RETELL_BASE_URL ?? "https://api.retellai.com").replace(/\/$/, "");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${base}/twilio-voice-webhook/${encodeURIComponent(agentId)}</Redirect></Response>`;
}

function mapTwilioStatusToPipeline(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "initiated") return "dialing";
  if (normalized === "ringing") return "ringing";
  if (normalized === "in-progress") return "answered";
  if (normalized === "completed") return "completed";
  if (normalized === "no-answer") return "no_answer";
  if (normalized === "busy") return "busy";
  if (normalized === "failed") return "failed";
  if (normalized === "canceled") return "canceled";
  return normalized || "unknown";
}

function toRealtimeCallStatus(status: string): "queued" | "dialing" | "connected" | "completed" | "failed" {
  if (status === "answered") return "connected";
  if (status === "dialing" || status === "ringing") return "dialing";
  if (status === "completed") return "completed";
  if (status === "queued" || status === "retry_scheduled") return "queued";
  return "failed";
}

function getNextRetryDate(attemptCount: number): Date | null {
  const mins = [15, 120, 1440, 4320][Math.max(0, attemptCount - 1)];
  if (!mins) return null;
  return new Date(Date.now() + mins * 60 * 1000);
}

function firstNonEmpty(...values: Array<unknown>): string | null {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text.length > 0) return text;
  }
  return null;
}

async function fetchSignalWireTranscriptText(url: string): Promise<string | null> {
  const projectId = process.env.SIGNALWIRE_PROJECT_ID;
  const apiToken = process.env.SIGNALWIRE_API_TOKEN;

  try {
    const authHeader = (projectId && apiToken)
      ? { Authorization: `Basic ${Buffer.from(`${projectId}:${apiToken}`).toString("base64")}` }
      : {};

    const res = await fetch(url, {
      headers: { ...authHeader } as Record<string, string>,
    });

    if (!res.ok) return null;

    const contentType = String(res.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("application/json")) {
      const json = await res.json() as Record<string, unknown>;
      const direct = firstNonEmpty(json.transcript, json.text, json.body);
      return direct;
    }

    const text = (await res.text()).trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

async function findTenantByVoiceNumber(toPhone: string) {
  const target = normalizePhone(toPhone);

  const indexedTenant = await db.query.tenants.findFirst({
    where: and(eq(tenants.active, true), eq(tenants.voiceNumber, target)),
  });

  if (indexedTenant) return indexedTenant;

  // Compatibility fallback while older tenants are backfilled from metadata.
  const activeTenants = await db.query.tenants.findMany({
    where: eq(tenants.active, true),
  });

  return activeTenants.find((t) => {
    const meta = (t.metadata as Record<string, unknown>) ?? {};
    const num =
      typeof meta.voice_number === "string"
        ? meta.voice_number
        : (typeof meta.voiceNumber === "string" ? meta.voiceNumber : "");
    return normalizePhone(num) === target;
  }) ?? null;
}

async function findProspectByPhone(tenantId: string, fromPhone: string) {
  const target = normalizePhone(fromPhone);
  if (!target) return null;

  const prospects = await db.query.prospectsRaw.findMany({
    where: eq(prospectsRaw.tenantId, tenantId),
    orderBy: desc(prospectsRaw.createdAt),
    limit: 200,
  });

  return prospects.find((p) => normalizePhone(p.phone ?? "") === target) ?? null;
}

router.post("/incoming", async (req: Request, res: Response, next: NextFunction) => {
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    if (!res.headersSent) {
      res.type("text/xml").send(twimlSay("Please hold while we connect you"));
    }
  }, 4000);

  const sendTwiml = (xml: string) => {
    if (timedOut || res.headersSent) return;
    res.type("text/xml").send(xml);
  };

  try {
    const toPhone = String(req.body.To ?? "");
    const fromPhone = String(req.body.From ?? "");
    const callSid = String(req.body.CallSid ?? "");

    const tenant = await findTenantByVoiceNumber(toPhone);
    if (!tenant) {
      sendTwiml(twimlSay("We could not route your call. Please try again later."));
      return;
    }

    const meta = (tenant.metadata as Record<string, unknown>) ?? {};
    const subscription = await db.query.tenantSubscriptions.findFirst({
      where: eq(tenantSubscriptions.tenantId, tenant.id),
    });
    const tenantAccess = resolveTenantBaseAccess(meta, subscription);
    if (!tenantAccess.assist) {
      sendTwiml(twimlSay("Voice assistant access is not enabled for this account."));
      return;
    }

    const trial = resolveTrialState(meta);
    const trialAccess = ((meta.trial_product_access as Record<string, unknown> | undefined) ?? {});
    if (trial.active && trialAccess.assist === true) {
      const remaining = Math.max(0, trial.callsRemaining - 1);
      await db
        .update(tenants)
        .set({
          metadata: {
            ...meta,
            trial_calls_remaining: remaining,
          },
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tenant.id));
    }

    // ── Retell runtime path ───────────────────────────────────────────────────
    const runtime = getVoiceRuntime(tenant.metadata);
    if (runtime === "retell") {
      const agentId = getRetellAgentId(tenant.metadata);
      if (agentId) {
        // Create a minimal session record for audit trail.
        // callAttempt is created by the Retell call-events or tool endpoints.
        await db.insert(assistantSessions).values({
          tenantId: tenant.id,
          sessionType: "voice_inbound",
        });
        sendTwiml(twimlRetellRedirect(agentId));
        return;
      }
      console.warn(`[voice/incoming] voice_runtime=retell but no agent ID configured for tenant ${tenant.id} — falling back to Twilio`);
    }

    // ── Twilio TwiML path (default) ───────────────────────────────────────────
    const prospect = await findProspectByPhone(tenant.id, fromPhone);

    const [session] = await db
      .insert(assistantSessions)
      .values({
        tenantId: tenant.id,
        prospectId: prospect?.id,
        sessionType: "voice_inbound",
      })
      .returning({ id: assistantSessions.id });

    if (prospect?.id) {
      await db.insert(callAttempts).values({
        tenantId: tenant.id,
        prospectId: prospect.id,
        callSid: callSid || null,
        outcome: "in_progress",
      });
    }

    const businessName = tenant.name || "the business";
    const greet = await greeting({ businessName });
    const reply = greet.ok ? greet.data.reply : "Hi, you've reached the business. I'm an AI assistant. How can I help you today?";

    const say = reply;
    const action = `/api/v1/voice/turn?sessionId=${encodeURIComponent(session.id)}`;
    sendTwiml(twimlGatherAndSayWithAction(action, say));
  } catch (err) {
    next(err);
  } finally {
    clearTimeout(timeout);
  }
});

router.post("/outbound/twiml", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const callAttemptId = String(req.query.callAttemptId ?? req.body?.callAttemptId ?? "").trim();
    if (!callAttemptId) {
      res.type("text/xml").send(twimlSay("We could not start this call. Please try again later."));
      return;
    }

    const attempt = await db.query.callAttempts.findFirst({
      where: eq(callAttempts.id, callAttemptId),
    });

    if (!attempt) {
      res.type("text/xml").send(twimlSay("This call request was not found."));
      return;
    }

    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, attempt.tenantId) });
    const businessName = tenant?.name || "the business";

    const [session] = await db
      .insert(assistantSessions)
      .values({
        tenantId: attempt.tenantId,
        prospectId: attempt.prospectId,
        sessionType: "voice_outbound",
      })
      .returning({ id: assistantSessions.id });

    const greet = await greeting({ businessName });
    const greetingText = greet.ok
      ? greet.data.reply
      : "Hi, this is an AI assistant calling from the business. How can I help you today?";

    const safeGreeting = `${greetingText} You can say stop at any time to opt out of future calls.`;
    const action = `/api/v1/voice/turn?sessionId=${encodeURIComponent(session.id)}&callAttemptId=${encodeURIComponent(callAttemptId)}`;
    res.type("text/xml").send(twimlGatherAndSayWithAction(action, safeGreeting));
  } catch (err) {
    next(err);
  }
});

router.post("/turn", async (req: Request, res: Response, next: NextFunction) => {
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    if (!res.headersSent) {
      res.type("text/xml").send(twimlSay("Please hold while we connect you"));
    }
  }, 4000);

  const sendTwiml = (xml: string) => {
    if (timedOut || res.headersSent) return;
    res.type("text/xml").send(xml);
  };

  try {
    const callSid = String(req.body.CallSid ?? "");
    const speech = String(req.body.SpeechResult ?? req.body.Body ?? "").trim();
    const sessionId = String(req.query.sessionId ?? req.body.sessionId ?? "").trim();
    const callAttemptId = String(req.query.callAttemptId ?? req.body.callAttemptId ?? "").trim();

    if (!speech) {
      sendTwiml(twimlGatherAndSay("I did not catch that. Could you repeat your request?"));
      return;
    }

    if (isDndRequest(speech)) {
      if (callAttemptId) {
        const attempt = await db.query.callAttempts.findFirst({
          where: eq(callAttempts.id, callAttemptId),
        });

        if (attempt) {
          const prospect = await db.query.prospectsRaw.findFirst({
            where: and(eq(prospectsRaw.id, attempt.prospectId), eq(prospectsRaw.tenantId, attempt.tenantId)),
          });

          await db.insert(doNotContact).values({
            tenantId: attempt.tenantId,
            phone: prospect?.phone ?? null,
            email: prospect?.email ?? null,
            domain: prospect?.domain ?? null,
            reason: "unsubscribe",
          });

          await db
            .update(callAttempts)
            .set({
              status: "dnd",
              outcome: "do_not_contact",
              dndAt: new Date(),
              nextAttemptAt: null,
            })
            .where(eq(callAttempts.id, callAttemptId));

          await db
            .update(callAttempts)
            .set({
              status: "dnd",
              outcome: "do_not_contact",
              dndAt: new Date(),
              nextAttemptAt: null,
            })
            .where(
              and(
                eq(callAttempts.tenantId, attempt.tenantId),
                eq(callAttempts.prospectId, attempt.prospectId),
                eq(callAttempts.direction, "outbound"),
                or(eq(callAttempts.status, "queued"), eq(callAttempts.status, "retry_scheduled")) as any,
              ),
            );
        }
      }

      sendTwiml(twimlSay("Understood. We will not call you again. Goodbye."));
      return;
    }

    const session = sessionId
      ? await db.query.assistantSessions.findFirst({ where: eq(assistantSessions.id, sessionId) })
      : null;

    if (!session) {
      sendTwiml(twimlSay("Your session was not found. Please call again so we can help."));
      return;
    }

    // Load stored conversation history and compact if needed
    type HistoryEntry = { role: "user" | "assistant"; content: string };
    const rawHistory = (session.conversationHistory as HistoryEntry[] | null) ?? [];

    let history: HistoryEntry[] = rawHistory;
    if (shouldCompact(session.turnCount)) {
      try {
        const compacted = await compactHistory({
          sessionId: session.id,
          messages: rawHistory.map((m) => ({ role: m.role, content: m.content })),
        });
        history = compacted
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: typeof m.content === "string" ? m.content : "" }));
      } catch (err) {
        console.error("[voice/turn] compaction failed, proceeding with raw history:", err);
      }
    }

    const turn = await processTurn({
      tenantId: session.tenantId,
      sessionId: session.id,
      message: speech,
      history,
      runId: callSid || undefined,
    });

    if (!turn.ok) {
      const transfer = await transferToStaff();
      const transferReply = transfer.ok
        ? transfer.data.reply
        : "I am connecting you with a team member now.";
      sendTwiml(twimlSay(transferReply));
      return;
    }

    const reply = turn.data.reply;

    // ── Escalation path ───────────────────────────────────────────────────────
    if (turn.data.escalate) {
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, session.tenantId) });
      const meta = (tenant?.metadata as Record<string, unknown>) ?? {};

      const escalationPhone =
        tenant?.escalationContactPhone ??
        (meta.escalationContactPhone as string | undefined) ??
        null;
      const escalationEmail =
        tenant?.escalationContactEmail ??
        (meta.escalationContactEmail as string | undefined) ??
        null;

      // Fetch prospect for notification context
      const prospectRow = session.prospectId
        ? await db.query.prospectsRaw.findFirst({ where: eq(prospectsRaw.id, session.prospectId) })
        : null;

      triggerEscalationNotifications({
        tenantId: session.tenantId,
        sessionId: session.id,
        prospectName: prospectRow?.businessName ?? "Caller",
        prospectPhone: prospectRow?.phone ?? null,
        escalationContactPhone: escalationPhone,
        escalationContactEmail: escalationEmail,
        fromNumber: tenant?.voiceNumber ?? (meta.voiceNumber as string | undefined) ?? null,
        escalationReason: turn.data.escalationReason,
        appBaseUrl: process.env.APP_BASE_URL,
      });

      await db
        .update(assistantSessions)
        .set({ escalated: true, conversationHistory: [...history, { role: "user", content: speech }, { role: "assistant", content: reply }] })
        .where(eq(assistantSessions.id, session.id));

      if (escalationPhone) {
        sendTwiml(twimlDial(escalationPhone, reply));
      } else {
        sendTwiml(twimlSay(reply));
      }
      return;
    }

    // Persist this turn to conversation history
    const updatedHistory: HistoryEntry[] = [
      ...history,
      { role: "user", content: speech },
      { role: "assistant", content: reply },
    ];
    await db
      .update(assistantSessions)
      .set({ conversationHistory: updatedHistory })
      .where(eq(assistantSessions.id, session.id));

    sendTwiml(twimlGatherAndSay(reply));
  } catch (err) {
    next(err);
  } finally {
    clearTimeout(timeout);
  }
});

router.post("/status", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const callSid = String(req.body.CallSid ?? "").trim();
    const queryCallAttemptId = String(req.query.callAttemptId ?? "").trim();

    if (!callSid && !queryCallAttemptId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "CallSid or callAttemptId is required" });
      return;
    }

    await webhookQueue.add("webhook", {
      kind: "voice_status",
      body: req.body as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      headers: {
        "x-signalwire-signature": String(req.headers["x-signalwire-signature"] ?? ""),
      },
    });

    res.type("text/xml").send(twimlEmpty());
  } catch (err) {
    next(err);
  }
});

export default router;
