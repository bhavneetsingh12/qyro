// QYRO Assist routes — Session N
// Auth + tenant scoping applied upstream.
//
// Routes:
//   GET  /api/sessions      — list assistant_sessions for tenant (paginated)
//   GET  /api/appointments  — list appointments for tenant (paginated)

import { Router, type Request, type Response, type NextFunction, type Router as ExpressRouter } from "express";
import { rateLimit } from "../middleware/rateLimit";
import { logAudit } from "../lib/auditLog";
import { triggerEscalationNotifications } from "../lib/escalation";
import { verifyWidgetToken } from "../lib/widgetAuth";

const MAX_PAGE_SIZE = 50;
import { db } from "@qyro/db";
import { assistantSessions, appointments, blackoutBlocks, prospectsRaw, messageAttempts, callAttempts, tenants, tenantSubscriptions, dailySummaries, consentRecords, suppressions, doNotContact, complianceDecisions } from "@qyro/db";
import { evaluateComplianceForProspect, resolveOutboundComplianceContextFromInput } from "@qyro/db";
import { eq, and, desc, sql, inArray, isNull, or, gte, lte } from "drizzle-orm";
import { runClientAssistant } from "@qyro/agents/clientAssistant";
import {
  executeBooking,
  attemptBlackoutWriteback,
  attemptBlackoutCancelWriteback,
} from "@qyro/agents/bookingService";
import { outboundCallQueue, publishRealtimeEvent, redis } from "@qyro/queue";
import { resolveTenantBaseAccess, resolveTrialState } from "../lib/entitlements";
import { resolveTenantAgentProfiles, resolveAssistantMode } from "../lib/agentProfiles";
import { isOptOutDisposition, isOptOutText, resolveInboundSuppressionType } from "../lib/optOut";

const router: ExpressRouter = Router();
const publicRouter: ExpressRouter = Router();
const OUTBOUND_CONTROL_ROLES = new Set(["owner", "admin", "operator"]);
const PUBLIC_RATE_WINDOW_SEC = 60;
const PUBLIC_RATE_LIMIT = 30;
const CALL_ATTEMPTS_SCHEMA_TTL_MS = 60_000;
const DEFAULT_WIDGET_DAILY_MESSAGE_LIMIT = 250;
const DEFAULT_WIDGET_DAILY_MISSED_CALL_LIMIT = 25;
const MISSED_CALL_PHONE_COOLDOWN_SEC = 30 * 60;

type CallAttemptsSchemaMode = "modern" | "legacy";

let callAttemptsSchemaCache:
  | { mode: CallAttemptsSchemaMode; expiresAt: number }
  | null = null;

function canManageOutbound(req: Request): boolean {
  return OUTBOUND_CONTROL_ROLES.has(req.userRole);
}

function normalizeBool(value: unknown): boolean {
  return value === true;
}

function getOutboundControl(meta: Record<string, unknown>) {
  const maxConcurrentRaw = Number(meta.outbound_voice_max_concurrent_calls ?? 3);
  return {
    enabled: meta.outbound_voice_enabled !== false,
    paused: normalizeBool(meta.outbound_voice_paused),
    pausedReason: (meta.outbound_voice_paused_reason as string) ?? "",
    maxConcurrentCalls: Number.isFinite(maxConcurrentRaw)
      ? Math.max(1, Math.min(Math.trunc(maxConcurrentRaw), 25))
      : 3,
  };
}

function outboundGlobalPauseEnabled(): boolean {
  return String(process.env.OUTBOUND_VOICE_GLOBAL_PAUSED ?? "false").toLowerCase() === "true";
}

function normalizePhone(value?: string | null): string {
  return (value ?? "").replace(/[^+\d]/g, "").trim();
}

function getEmailDomain(email?: string | null): string | null {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!normalized.includes("@")) return null;
  const domain = normalized.split("@").pop()?.trim() ?? "";
  return domain || null;
}

async function createSuppressionAndRevokeConsent(params: {
  tenantId: string;
  phone?: string | null;
  email?: string | null;
  domain?: string | null;
  suppressionType: "stop_reply" | "verbal_optout" | "manual_block";
  reason: string;
}) {
  const phone = normalizePhone(params.phone);
  const email = String(params.email ?? "").trim().toLowerCase();
  const domain = String(params.domain ?? "").trim().toLowerCase() || getEmailDomain(email) || "";
  if (!phone && !email && !domain) return false;

  const now = new Date();
  await db.insert(suppressions).values({
    tenantId: params.tenantId,
    phoneE164: phone || null,
    email: email || null,
    domain: domain || null,
    suppressionType: params.suppressionType,
    scope: "global",
    reason: params.reason,
    effectiveAt: now,
  });

  await db.insert(doNotContact).values({
    tenantId: params.tenantId,
    phone: phone || null,
    email: email || null,
    domain: domain || null,
    reason: params.reason,
  });

  if (phone) {
    await db
      .update(consentRecords)
      .set({
        revokedAt: now,
        revokedReason: params.reason,
      })
      .where(and(
        eq(consentRecords.tenantId, params.tenantId),
        eq(consentRecords.phoneE164, phone),
        isNull(consentRecords.revokedAt),
      ));
  }

  return true;
}

type ConsentPayload = {
  given?: boolean;
  consentChannel?: string;
  consentType?: string;
  disclosureText?: string;
  disclosureVersion?: string;
  formUrl?: string;
  sellerName?: string;
  capturedAt?: string;
};

function normalizeConsentChannel(value: unknown): "voice" | "sms" | "both" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "voice" || normalized === "sms" || normalized === "both") return normalized;
  return "both";
}

function normalizeConsentType(value: unknown): "written" | "express" | "inquiry_only" | "unknown" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "written" || normalized === "express" || normalized === "inquiry_only" || normalized === "unknown") return normalized;
  return "written";
}

async function captureConsentEvidence(params: {
  tenantId: string;
  prospectId: string;
  phone: string | null;
  sellerName: string;
  consent?: ConsentPayload | null;
  req: Request;
}): Promise<boolean> {
  const normalizedPhone = normalizePhone(params.phone);
  if (!normalizedPhone || !params.consent || params.consent.given !== true) return false;

  const capturedAt = params.consent.capturedAt ? new Date(params.consent.capturedAt) : new Date();
  await db.insert(consentRecords).values({
    tenantId: params.tenantId,
    prospectId: params.prospectId,
    phoneE164: normalizedPhone,
    sellerName: String(params.consent.sellerName ?? params.sellerName).trim() || params.sellerName,
    consentChannel: normalizeConsentChannel(params.consent.consentChannel),
    consentType: normalizeConsentType(params.consent.consentType),
    disclosureText: String(params.consent.disclosureText ?? "").trim() || null,
    disclosureVersion: String(params.consent.disclosureVersion ?? "").trim() || null,
    formUrl: String(params.consent.formUrl ?? "").trim() || null,
    capturedAt: isNaN(capturedAt.getTime()) ? new Date() : capturedAt,
    ipAddress: getRequestIp(params.req),
    userAgent: params.req.headers["user-agent"] ? String(params.req.headers["user-agent"]) : null,
  });

  await db
    .update(prospectsRaw)
    .set({ consentState: "given" })
    .where(and(eq(prospectsRaw.tenantId, params.tenantId), eq(prospectsRaw.id, params.prospectId)));

  return true;
}

function isMissingColumnError(err: unknown): boolean {
  return (err as { code?: string })?.code === "42703";
}

async function getCallAttemptsSchemaMode(): Promise<CallAttemptsSchemaMode> {
  const now = Date.now();
  if (callAttemptsSchemaCache && callAttemptsSchemaCache.expiresAt > now) {
    return callAttemptsSchemaCache.mode;
  }

  const rows = await db.execute<{ column_name: string }>(sql`
    select column_name
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'call_attempts'
      and column_name in (
        'direction',
        'status',
        'attempt_count',
        'max_attempts',
        'next_attempt_at',
        'last_attempt_at',
        'dnd_at'
      )
  `);

  const available = new Set((rows as Array<{ column_name: string }>).map((row) => row.column_name));
  const required = ["direction", "status", "attempt_count", "max_attempts", "next_attempt_at", "last_attempt_at", "dnd_at"];
  const mode: CallAttemptsSchemaMode = required.every((col) => available.has(col)) ? "modern" : "legacy";

  callAttemptsSchemaCache = { mode, expiresAt: now + CALL_ATTEMPTS_SCHEMA_TTL_MS };
  return mode;
}

function getRequestIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function parseAllowedOrigins(meta: Record<string, unknown>): string[] {
  const raw = meta.widget_allowed_origins ?? meta.widgetAllowedOrigins;
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw.split(",").map((value) => value.trim()).filter(Boolean);
  }
  return [];
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "").toLowerCase();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validateWidgetOrigin(req: Request, tenant: { metadata: unknown }): string | null {
  const meta = (tenant.metadata as Record<string, unknown> | null) ?? {};
  const allowedOrigins = parseAllowedOrigins(meta).map(normalizeOrigin);
  const origin = String(req.headers.origin ?? "").trim();

  if (allowedOrigins.length === 0) {
    return process.env.NODE_ENV === "production"
      ? "widget allowed origins are not configured for this tenant"
      : null;
  }

  if (!origin) {
    return "Origin header is required";
  }

  return allowedOrigins.includes(normalizeOrigin(origin)) ? null : "Origin is not allowed for this tenant";
}

async function enforcePublicRateLimit(req: Request, tenantId: string): Promise<string | null> {
  const key = `rl:widget:${tenantId}:${getRequestIp(req)}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, PUBLIC_RATE_WINDOW_SEC);
  }
  if (count > PUBLIC_RATE_LIMIT) {
    return "Too many requests";
  }
  return null;
}

function getWidgetToken(req: Request): string {
  return String(
    req.headers["x-qyro-widget-token"]
    ?? req.body?.widgetToken
    ?? req.query.widgetToken
    ?? "",
  ).trim();
}

function getTenantMetadata(tenant: { metadata: unknown }): Record<string, unknown> {
  return (tenant.metadata as Record<string, unknown> | null) ?? {};
}

function getPositiveInteger(meta: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(meta[key] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.trunc(value), 50_000));
}

async function enforcePublicDailyBudget(params: {
  tenantId: string;
  bucket: "chat" | "missed_call";
  limit: number;
}): Promise<string | null> {
  const day = new Date().toISOString().slice(0, 10);
  const key = `rl:widget:${params.bucket}:day:${params.tenantId}:${day}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 86_400);
  }
  if (count > params.limit) {
    return "This public assistant limit has been reached for today";
  }
  return null;
}

async function enforceMissedCallCooldown(tenantId: string, phone: string): Promise<string | null> {
  if (!phone) return null;
  const key = `rl:widget:missed-call:phone:${tenantId}:${phone}`;
  const result = await redis.set(key, "1", "EX", MISSED_CALL_PHONE_COOLDOWN_SEC, "NX");
  if (result !== "OK") {
    return "A follow-up was already sent recently for this phone number";
  }
  return null;
}

function validateWidgetAccess(req: Request, tenant: { id: string; metadata: unknown }): string | null {
  const widgetToken = getWidgetToken(req);
  if (!widgetToken) {
    return "Widget token is required";
  }

  const tokenCheck = verifyWidgetToken({
    token: widgetToken,
    tenantId: tenant.id,
    metadata: tenant.metadata,
  });
  if (!tokenCheck.ok) {
    return tokenCheck.message;
  }

  return validateWidgetOrigin(req, tenant);
}

async function getOrCreateProspect(params: {
  tenantId: string;
  name?: string;
  phone?: string;
  email?: string;
}) {
  const phone = params.phone?.trim() || null;
  const email = params.email?.trim().toLowerCase() || null;

  if (phone || email) {
    const existing = await db.query.prospectsRaw.findFirst({
      where: and(
        eq(prospectsRaw.tenantId, params.tenantId),
        or(
          phone ? eq(prospectsRaw.phone, phone) : undefined,
          email ? eq(prospectsRaw.email, email) : undefined,
        ) as any,
      ) as any,
    });
    if (existing) return existing;
  }

  const [created] = await db
    .insert(prospectsRaw)
    .values({
      tenantId: params.tenantId,
      source: "inbound_form",
      businessName: params.name || "Website Visitor",
      phone,
      email,
      prospectTimezone: null,
      consentState: "unknown",
    })
    .returning();

  return created;
}

// ─── GET /api/sessions ─────────────────────────────────────────────────────────

router.get("/sessions", rateLimit("heavy"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const limit  = Math.min(parseInt((req.query.limit  as string) || "50",  10), MAX_PAGE_SIZE);
    const offset = parseInt((req.query.offset as string) || "0", 10);

    const rows = await db
      .select({
        id:            assistantSessions.id,
        sessionType:   assistantSessions.sessionType,
        turnCount:     assistantSessions.turnCount,
        escalated:     assistantSessions.escalated,
        endedAt:       assistantSessions.endedAt,
        createdAt:     assistantSessions.createdAt,
        prospectId:    assistantSessions.prospectId,
        prospectPhone: prospectsRaw.phone,
        prospectName:  prospectsRaw.businessName,
        // conversationHistory omitted — contains full chat, use /sessions/:id for detail
      })
      .from(assistantSessions)
      .leftJoin(prospectsRaw, eq(assistantSessions.prospectId, prospectsRaw.id))
      .where(eq(assistantSessions.tenantId, tenantId))
      .orderBy(desc(assistantSessions.createdAt))
      .limit(limit)
      .offset(offset);

    logAudit({ req, tenantId, userId: req.userId, action: "sessions.list", resourceType: "session", responseRecordCount: rows.length });

    res.json({ data: rows, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/appointments ─────────────────────────────────────────────────────

router.get("/appointments", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const limit  = Math.min(parseInt((req.query.limit  as string) || "50",  10), MAX_PAGE_SIZE);
    const offset = parseInt((req.query.offset as string) || "0", 10);

    const rows = await db
      .select({
        id:            appointments.id,
        startAt:       appointments.startAt,
        endAt:         appointments.endAt,
        status:        appointments.status,
        notes:         appointments.notes,
        createdAt:     appointments.createdAt,
        prospectId:    appointments.prospectId,
        prospectName:  prospectsRaw.businessName,
        prospectPhone: prospectsRaw.phone,
      })
      .from(appointments)
      .leftJoin(prospectsRaw, eq(appointments.prospectId, prospectsRaw.id))
      .where(eq(appointments.tenantId, tenantId))
      .orderBy(desc(appointments.startAt))
      .limit(limit)
      .offset(offset);

    res.json({ data: rows, limit, offset });
  } catch (err) {
    next(err);
  }
});



// ─── POST /api/v1/assist/approve/:messageId ──────────────────────────────────

router.post("/v1/assist/approve/:messageId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const messageId = req.params.messageId;

    const [updated] = await db
      .update(messageAttempts)
      .set({ status: "approved" })
      .where(
        and(
          eq(messageAttempts.tenantId, tenantId),
          eq(messageAttempts.id, messageId),
          eq(messageAttempts.status, "pending_approval"),
        ),
      )
      .returning({ id: messageAttempts.id, status: messageAttempts.status });

    if (!updated) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pending message not found" });
      return;
    }

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/assist/reject/:messageId ───────────────────────────────────

router.post("/v1/assist/reject/:messageId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const messageId = req.params.messageId;

    const [updated] = await db
      .update(messageAttempts)
      .set({ status: "failed" })
      .where(
        and(
          eq(messageAttempts.tenantId, tenantId),
          eq(messageAttempts.id, messageId),
          eq(messageAttempts.status, "pending_approval"),
        ),
      )
      .returning({ id: messageAttempts.id, status: messageAttempts.status });

    if (!updated) {
      res.status(404).json({ error: "NOT_FOUND", message: "Pending message not found" });
      return;
    }

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/assist/pending ──────────────────────────────────────────────

router.get("/v1/assist/pending", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), MAX_PAGE_SIZE);
    const offset = parseInt((req.query.offset as string) || "0", 10);

    const rows = await db
      .select({
        id: messageAttempts.id,
        prospectId: messageAttempts.prospectId,
        channel: messageAttempts.channel,
        messageText: messageAttempts.messageText,
        status: messageAttempts.status,
        createdAt: messageAttempts.createdAt,
      })
      .from(messageAttempts)
      .where(
        and(
          eq(messageAttempts.tenantId, tenantId),
          eq(messageAttempts.status, "pending_approval"),
        ),
      )
      .orderBy(desc(messageAttempts.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ data: rows, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/assist/calls ────────────────────────────────────────────────

router.get("/v1/assist/calls", rateLimit("heavy"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), MAX_PAGE_SIZE);
    const offset = parseInt((req.query.offset as string) || "0", 10);
    const outcome = ((req.query.outcome as string) || "").trim();

    const whereClause = outcome
      ? and(eq(callAttempts.tenantId, tenantId), eq(callAttempts.outcome, outcome))
      : eq(callAttempts.tenantId, tenantId);

    const rows = await db
      .select({
        id:           callAttempts.id,
        prospectId:   callAttempts.prospectId,
        prospectName: prospectsRaw.businessName,
        direction:    callAttempts.direction,
        status:       callAttempts.status,
        duration:     callAttempts.duration,
        durationSeconds: callAttempts.durationSeconds,
        outcome:      callAttempts.outcome,
        recordingUrl: callAttempts.recordingUrl,
        transcriptText: callAttempts.transcriptText,
        transcriptJson: callAttempts.transcriptJson,
        transcriptUrl: callAttempts.transcriptUrl,
        callSid:      callAttempts.callSid,
        createdAt:    callAttempts.createdAt,
      })
      .from(callAttempts)
      .leftJoin(prospectsRaw, eq(callAttempts.prospectId, prospectsRaw.id))
      .where(whereClause as any)
      .orderBy(desc(callAttempts.createdAt))
      .limit(limit)
      .offset(offset);

    logAudit({ req, tenantId, userId: req.userId, action: "calls.list", resourceType: "call", responseRecordCount: rows.length });

    res.json({ data: rows, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/assist/outbound-calls/enqueue ─────────────────────────────

router.post("/v1/assist/outbound-calls/enqueue", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.userId;

    const tenant = await db.query.tenants.findFirst({
      where: and(eq(tenants.id, tenantId), eq(tenants.active, true)),
    });

    const tenantMeta = (tenant?.metadata as Record<string, unknown> | null) ?? {};
    const subscription = await db.query.tenantSubscriptions.findFirst({
      where: eq(tenantSubscriptions.tenantId, tenantId),
    });
    const tenantAccess = resolveTenantBaseAccess(tenantMeta, subscription);
    if (!tenantAccess.lead) {
      res.status(403).json({
        error: "ACCESS_BLOCK",
        message: "Lead access is not enabled for this tenant",
      });
      return;
    }
    if (!tenantAccess.assist) {
      res.status(403).json({
        error: "ACCESS_BLOCK",
        message: "Assist access is required to queue outbound calls",
      });
      return;
    }

    if (tenantMeta.outbound_voice_enabled === false) {
      res.status(403).json({
        error: "COMPLIANCE_BLOCK",
        message: "Outbound voice is disabled for this tenant",
      });
      return;
    }

    if (tenantMeta.outbound_voice_paused === true || outboundGlobalPauseEnabled()) {
      res.status(409).json({
        error: "OUTBOUND_PAUSED",
        message: outboundGlobalPauseEnabled()
          ? "Outbound voice is globally paused"
          : "Outbound voice is paused for this tenant",
      });
      return;
    }

    const prospectIds = Array.isArray(req.body?.prospectIds)
      ? req.body.prospectIds.map((v: unknown) => String(v)).filter(Boolean)
      : [];

    const numbers = Array.isArray(req.body?.numbers)
      ? req.body.numbers.map((v: unknown) => normalizePhone(String(v))).filter(Boolean)
      : [];

    if (prospectIds.length === 0 && numbers.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "prospectIds or numbers is required" });
      return;
    }

    const maxAttemptsRaw = Number.parseInt(String(req.body?.maxAttempts ?? "4"), 10);
    const maxAttempts = Number.isFinite(maxAttemptsRaw)
      ? Math.max(1, Math.min(maxAttemptsRaw, 8))
      : 4;
    const complianceContext = resolveOutboundComplianceContextFromInput({
      body: req.body,
      defaultSellerName: tenant?.name ?? null,
    });

    const prospectSet = new Set<string>();
    const createdProspectIds: string[] = [];

    for (const pid of prospectIds) prospectSet.add(pid);

    for (const num of numbers) {
      const existing = await db.query.prospectsRaw.findFirst({
        where: and(eq(prospectsRaw.tenantId, tenantId), eq(prospectsRaw.phone, num)) as any,
      });

      if (existing) {
        prospectSet.add(existing.id);
        continue;
      }

      const [created] = await db
        .insert(prospectsRaw)
        .values({
          tenantId,
          source: "manual_outbound",
          businessName: `Outbound Lead ${num}`,
          phone: num,
          consentState: "unknown",
        })
        .returning({ id: prospectsRaw.id });

      prospectSet.add(created.id);
      createdProspectIds.push(created.id);
    }

    let enqueued = 0;
    const callAttemptIds: string[] = [];
    const blockedByCompliance: Array<{ prospectId: string; decision: string; ruleCode: string; explanation: string }> = [];
    const schemaMode = await getCallAttemptsSchemaMode();
    const legacyMode = schemaMode === "legacy";

    for (const prospectId of prospectSet) {
      const prospect = await db.query.prospectsRaw.findFirst({
        where: and(eq(prospectsRaw.id, prospectId), eq(prospectsRaw.tenantId, tenantId)),
      });

      if (!prospect || !normalizePhone(prospect.phone)) continue;

      const compliance = await evaluateComplianceForProspect({
        tenantId,
        prospectId: prospect.id,
        channel: "voice",
        automated: complianceContext.automated,
        strictMode: tenantMeta.tcpa_strict_mode === true,
        sellerName: complianceContext.sellerName,
        campaignId: complianceContext.campaignId,
      });

      if (compliance.decision !== "ALLOW") {
        blockedByCompliance.push({
          prospectId: prospect.id,
          decision: compliance.decision,
          ruleCode: compliance.ruleCode,
          explanation: compliance.explanation,
        });

        if (!legacyMode) {
          const [attempt] = await db
            .insert(callAttempts)
            .values({
              tenantId,
              prospectId: prospect.id,
              direction: "outbound",
              source: "lead_manual",
              campaignId: complianceContext.campaignId,
              complianceSellerName: complianceContext.sellerName,
              complianceAutomated: complianceContext.automated,
              status: "blocked_compliance",
              outcome: "blocked_compliance",
              complianceBlockedReason: `${compliance.decision}:${compliance.ruleCode}`,
              attemptCount: 0,
              maxAttempts,
              scheduledBy: userId,
            })
            .returning({ id: callAttempts.id });

          void publishRealtimeEvent({
            type: "call_status_change",
            tenantId,
            payload: {
              callAttemptId: attempt.id,
              prospectId: prospect.id,
              status: "failed",
            },
          }).catch((err) => {
            console.error("[assist/outbound-calls/enqueue] compliance block realtime publish failed:", err);
          });
        }
        continue;
      }

      let attemptId: string;
      if (schemaMode === "modern") {
        const [attempt] = await db
          .insert(callAttempts)
          .values({
            tenantId,
            prospectId,
            direction: "outbound",
            source: "lead_manual",
            campaignId: complianceContext.campaignId,
            complianceSellerName: complianceContext.sellerName,
            complianceAutomated: complianceContext.automated,
            status: "queued",
            outcome: "queued",
            attemptCount: 0,
            maxAttempts,
            scheduledBy: userId,
          })
          .returning({ id: callAttempts.id });

        attemptId = attempt.id;
      } else {
        // Legacy schema path: only insert columns that definitely exist.
        const legacyInserted = await db.execute<{ id: string }>(sql`
          insert into call_attempts (tenant_id, prospect_id, outcome)
          values (${tenantId}, ${prospectId}, ${"queued"})
          returning id
        `);
        attemptId = (legacyInserted as Array<{ id: string }>)[0]?.id;
        if (!attemptId) {
          throw new Error("Failed to create legacy call attempt");
        }
      }

      callAttemptIds.push(attemptId);

      void publishRealtimeEvent({
        type: "call_status_change",
        tenantId,
        payload: {
          callAttemptId: attemptId,
          prospectId,
          status: "queued",
        },
      }).catch((err) => {
        console.error("[assist/outbound-calls/enqueue] realtime publish failed:", err);
      });

      if (!legacyMode) {
        await outboundCallQueue.add(
          "outbound-call",
          { tenantId, callAttemptId: attemptId },
          { jobId: `outbound-call:${attemptId}:1` },
        );
      }

      enqueued += 1;
    }

    const trial = resolveTrialState(tenantMeta);
    const trialAccess = ((tenantMeta.trial_product_access as Record<string, unknown> | undefined) ?? {});
    if (trial.active && trialAccess.lead === true) {
      const remaining = Math.max(0, trial.callsRemaining - enqueued);
      await db
        .update(tenants)
        .set({
          metadata: {
            ...tenantMeta,
            trial_calls_remaining: remaining,
          },
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tenantId));
    }

    res.json({
      data: {
        enqueued,
        callAttemptIds,
        createdProspectIds,
        blockedByCompliance,
        legacyMode,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/assist/compliance/consent ──────────────────────────────────

router.post("/v1/assist/compliance/consent", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManageOutbound(req)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Insufficient permissions for compliance controls" });
      return;
    }

    const tenantId = req.tenantId;
    const tenant = await db.query.tenants.findFirst({
      where: and(eq(tenants.id, tenantId), eq(tenants.active, true)),
    });
    if (!tenant) {
      res.status(404).json({ error: "NOT_FOUND", message: "Tenant not found" });
      return;
    }

    const body = req.body as {
      prospectId?: string;
      phone?: string;
      sellerName?: string;
      consentChannel?: string;
      consentType?: string;
      disclosureText?: string;
      disclosureVersion?: string;
      formUrl?: string;
      capturedAt?: string;
    };

    const normalizedPhone = normalizePhone(body.phone);
    const prospectId = String(body.prospectId ?? "").trim();
    const consentChannel = String(body.consentChannel ?? "voice").trim().toLowerCase();
    const consentType = String(body.consentType ?? "written").trim().toLowerCase();
    const capturedAt = body.capturedAt ? new Date(body.capturedAt) : new Date();
    if (!normalizedPhone || !normalizedPhone.startsWith("+")) {
      res.status(400).json({ error: "INVALID_INPUT", message: "phone (E.164) is required" });
      return;
    }
    if (!["voice", "sms", "both"].includes(consentChannel)) {
      res.status(400).json({ error: "INVALID_INPUT", message: "consentChannel must be voice, sms, or both" });
      return;
    }
    if (!["written", "express", "inquiry_only", "unknown"].includes(consentType)) {
      res.status(400).json({ error: "INVALID_INPUT", message: "consentType must be written, express, inquiry_only, or unknown" });
      return;
    }

    let resolvedProspectId: string | null = null;
    if (prospectId) {
      const prospect = await db.query.prospectsRaw.findFirst({
        where: and(eq(prospectsRaw.id, prospectId), eq(prospectsRaw.tenantId, tenantId)),
      });
      resolvedProspectId = prospect?.id ?? null;
    } else {
      const prospect = await db.query.prospectsRaw.findFirst({
        where: and(eq(prospectsRaw.tenantId, tenantId), eq(prospectsRaw.phone, normalizedPhone)) as any,
      });
      resolvedProspectId = prospect?.id ?? null;
    }

    const [created] = await db
      .insert(consentRecords)
      .values({
        tenantId,
        prospectId: resolvedProspectId,
        phoneE164: normalizedPhone,
        sellerName: String(body.sellerName ?? tenant.name).trim(),
        consentChannel,
        consentType,
        disclosureText: String(body.disclosureText ?? "").trim() || null,
        disclosureVersion: String(body.disclosureVersion ?? "").trim() || null,
        formUrl: String(body.formUrl ?? "").trim() || null,
        capturedAt,
        ipAddress: getRequestIp(req),
        userAgent: req.headers["user-agent"] ? String(req.headers["user-agent"]) : null,
      })
      .returning({ id: consentRecords.id });

    res.json({ data: { id: created.id } });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/assist/compliance/suppressions ─────────────────────────────

router.post("/v1/assist/compliance/suppressions", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManageOutbound(req)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Insufficient permissions for compliance controls" });
      return;
    }

    const tenantId = req.tenantId;
    const body = req.body as {
      phone?: string;
      email?: string;
      domain?: string;
      suppressionType?: string;
      scope?: string;
      reason?: string;
      sellerName?: string;
      effectiveAt?: string;
    };

    const phone = normalizePhone(body.phone);
    const email = String(body.email ?? "").trim().toLowerCase();
    const domain = String(body.domain ?? "").trim().toLowerCase();
    if (!phone && !email && !domain) {
      res.status(400).json({ error: "INVALID_INPUT", message: "phone, email, or domain is required" });
      return;
    }

    const suppressionType = String(body.suppressionType ?? "manual_block").trim().toLowerCase();
    const scope = String(body.scope ?? "global").trim().toLowerCase();
    const effectiveAt = body.effectiveAt ? new Date(body.effectiveAt) : new Date();

    const [created] = await db
      .insert(suppressions)
      .values({
        tenantId,
        phoneE164: phone || null,
        email: email || null,
        domain: domain || null,
        suppressionType,
        scope,
        sellerName: String(body.sellerName ?? "").trim() || null,
        reason: String(body.reason ?? "").trim() || null,
        effectiveAt,
      })
      .returning({ id: suppressions.id });

    await db.insert(doNotContact).values({
      tenantId,
      phone: phone || null,
      email: email || null,
      domain: domain || null,
      reason: suppressionType || "manual",
      addedBy: req.userId,
    });

    res.json({ data: { id: created.id } });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/assist/compliance/inbound-events ───────────────────────────

router.post("/v1/assist/compliance/inbound-events", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManageOutbound(req)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Insufficient permissions for compliance controls" });
      return;
    }

    const tenantId = req.tenantId;
    const body = req.body as {
      channel?: string;
      text?: string;
      disposition?: string;
      reason?: string;
      phone?: string;
      email?: string;
      domain?: string;
      prospectId?: string;
      sourceEventId?: string;
    };

    const channel = String(body.channel ?? "sms").trim().toLowerCase();
    const text = String(body.text ?? "").trim();
    const disposition = String(body.disposition ?? "").trim().toLowerCase();
    const explicitReason = String(body.reason ?? "").trim();

    const optOutRequested = isOptOutText(text) || isOptOutDisposition(disposition);
    if (!optOutRequested) {
      res.json({ data: { applied: false, reason: "ignored_non_optout_event" } });
      return;
    }

    const prospectId = String(body.prospectId ?? "").trim();
    const prospect = prospectId
      ? await db.query.prospectsRaw.findFirst({
          where: and(eq(prospectsRaw.tenantId, tenantId), eq(prospectsRaw.id, prospectId)),
        })
      : null;

    const suppressionType = resolveInboundSuppressionType({ channel, disposition });
    const reason = explicitReason || disposition || (text ? "inbound_opt_out_text" : "inbound_opt_out");
    const applied = await createSuppressionAndRevokeConsent({
      tenantId,
      phone: String(body.phone ?? prospect?.phone ?? ""),
      email: String(body.email ?? prospect?.email ?? ""),
      domain: String(body.domain ?? prospect?.domain ?? ""),
      suppressionType,
      reason,
    });

    if (applied && prospect?.id) {
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
            eq(callAttempts.tenantId, tenantId),
            eq(callAttempts.prospectId, prospect.id),
            eq(callAttempts.direction, "outbound"),
            or(
              eq(callAttempts.status, "queued"),
              eq(callAttempts.status, "retry_scheduled"),
              eq(callAttempts.status, "dialing"),
              eq(callAttempts.status, "ringing"),
            ) as any,
          ),
        );
    }

    res.json({
      data: {
        applied,
        suppressionType,
        reason,
        prospectId: prospect?.id ?? null,
        sourceEventId: String(body.sourceEventId ?? "").trim() || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/assist/compliance/decisions ────────────────────────────────

router.get("/v1/assist/compliance/decisions", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManageOutbound(req)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Insufficient permissions for compliance reporting" });
      return;
    }

    const tenantId = req.tenantId;
    const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 100);
    const decisionFilter = String(req.query.decision ?? "open").trim().toUpperCase();
    const openOnly = decisionFilter === "OPEN";
    const resolvedOnly = decisionFilter === "RESOLVED";

    const decisionWhere =
      decisionFilter === "BLOCK"
        ? eq(complianceDecisions.decision, "BLOCK")
        : decisionFilter === "MANUAL_REVIEW"
          ? eq(complianceDecisions.decision, "MANUAL_REVIEW")
          : inArray(complianceDecisions.decision, ["BLOCK", "MANUAL_REVIEW"]);

    const rows = await db
      .select({
        id: complianceDecisions.id,
        decision: complianceDecisions.decision,
        ruleCode: complianceDecisions.ruleCode,
        explanation: complianceDecisions.explanation,
        channel: complianceDecisions.channel,
        automated: complianceDecisions.automated,
        evaluatedAt: complianceDecisions.evaluatedAt,
        resolvedAt: complianceDecisions.resolvedAt,
        resolvedBy: complianceDecisions.resolvedBy,
        resolutionAction: complianceDecisions.resolutionAction,
        resolutionNote: complianceDecisions.resolutionNote,
        prospectId: prospectsRaw.id,
        businessName: prospectsRaw.businessName,
        phone: prospectsRaw.phone,
        email: prospectsRaw.email,
        domain: prospectsRaw.domain,
      })
      .from(complianceDecisions)
      .leftJoin(prospectsRaw, eq(complianceDecisions.prospectId, prospectsRaw.id))
      .where(and(
        eq(complianceDecisions.tenantId, tenantId),
        decisionWhere,
        openOnly ? isNull(complianceDecisions.resolvedAt) : undefined,
        resolvedOnly ? sql`${complianceDecisions.resolvedAt} is not null` : undefined,
      ))
      .orderBy(desc(complianceDecisions.evaluatedAt))
      .limit(limit);

    res.json({ data: rows, limit });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/assist/compliance/decisions/:id/resolve ───────────────────

router.post("/v1/assist/compliance/decisions/:id/resolve", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManageOutbound(req)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Insufficient permissions for compliance controls" });
      return;
    }

    const tenantId = req.tenantId;
    const id = String(req.params.id ?? "").trim();
    if (!id) {
      res.status(400).json({ error: "INVALID_INPUT", message: "decision id is required" });
      return;
    }

    const body = req.body as {
      action?: string;
      note?: string;
    };
    const action = String(body.action ?? "dismissed").trim().toLowerCase();
    const note = String(body.note ?? "").trim();
    if (!action) {
      res.status(400).json({ error: "INVALID_INPUT", message: "action is required" });
      return;
    }

    const [updated] = await db
      .update(complianceDecisions)
      .set({
        resolvedAt: new Date(),
        resolvedBy: req.userId,
        resolutionAction: action,
        resolutionNote: note || null,
      })
      .where(and(
        eq(complianceDecisions.tenantId, tenantId),
        eq(complianceDecisions.id, id),
      ))
      .returning({ id: complianceDecisions.id, resolvedAt: complianceDecisions.resolvedAt });

    if (!updated) {
      res.status(404).json({ error: "NOT_FOUND", message: "Compliance decision not found" });
      return;
    }

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/assist/compliance/decisions/:id/reopen ────────────────────

router.post("/v1/assist/compliance/decisions/:id/reopen", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManageOutbound(req)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Insufficient permissions for compliance controls" });
      return;
    }

    const tenantId = req.tenantId;
    const id = String(req.params.id ?? "").trim();
    if (!id) {
      res.status(400).json({ error: "INVALID_INPUT", message: "decision id is required" });
      return;
    }

    const [updated] = await db
      .update(complianceDecisions)
      .set({
        resolvedAt: null,
        resolvedBy: null,
        resolutionAction: null,
        resolutionNote: null,
      })
      .where(and(
        eq(complianceDecisions.tenantId, tenantId),
        eq(complianceDecisions.id, id),
      ))
      .returning({ id: complianceDecisions.id, resolvedAt: complianceDecisions.resolvedAt });

    if (!updated) {
      res.status(404).json({ error: "NOT_FOUND", message: "Compliance decision not found" });
      return;
    }

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/assist/compliance/report ───────────────────────────────────

router.get("/v1/assist/compliance/report", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManageOutbound(req)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Insufficient permissions for compliance reporting" });
      return;
    }

    const tenantId = req.tenantId;
    const days = Math.max(1, Math.min(parseInt(String(req.query.days ?? "7"), 10), 30));
    const cutoff = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);

    const totals = await db
      .select({
        decision: complianceDecisions.decision,
        count: sql<number>`count(*)`,
      })
      .from(complianceDecisions)
      .where(and(eq(complianceDecisions.tenantId, tenantId), gte(complianceDecisions.evaluatedAt, cutoff)))
      .groupBy(complianceDecisions.decision);

    const byRule = await db
      .select({
        ruleCode: complianceDecisions.ruleCode,
        decision: complianceDecisions.decision,
        count: sql<number>`count(*)`,
      })
      .from(complianceDecisions)
      .where(and(eq(complianceDecisions.tenantId, tenantId), gte(complianceDecisions.evaluatedAt, cutoff)))
      .groupBy(complianceDecisions.ruleCode, complianceDecisions.decision)
      .orderBy(desc(sql<number>`count(*)`))
      .limit(20);

    const byDay = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${complianceDecisions.evaluatedAt}), 'YYYY-MM-DD')`,
        decision: complianceDecisions.decision,
        count: sql<number>`count(*)`,
      })
      .from(complianceDecisions)
      .where(and(eq(complianceDecisions.tenantId, tenantId), gte(complianceDecisions.evaluatedAt, cutoff)))
      .groupBy(sql`date_trunc('day', ${complianceDecisions.evaluatedAt})`, complianceDecisions.decision)
      .orderBy(sql`date_trunc('day', ${complianceDecisions.evaluatedAt})`);

    res.json({
      data: {
        days,
        totals,
        byRule,
        byDay,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/assist/compliance/alerts ───────────────────────────────────

router.get("/v1/assist/compliance/alerts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManageOutbound(req)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Insufficient permissions for compliance reporting" });
      return;
    }

    const tenantId = req.tenantId;
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);

    const todayRows = await db
      .select({
        decision: complianceDecisions.decision,
        count: sql<number>`count(*)`,
      })
      .from(complianceDecisions)
      .where(and(eq(complianceDecisions.tenantId, tenantId), gte(complianceDecisions.evaluatedAt, todayStart)))
      .groupBy(complianceDecisions.decision);

    const weekRows = await db
      .select({
        decision: complianceDecisions.decision,
        count: sql<number>`count(*)`,
      })
      .from(complianceDecisions)
      .where(and(eq(complianceDecisions.tenantId, tenantId), gte(complianceDecisions.evaluatedAt, weekStart), lte(complianceDecisions.evaluatedAt, todayStart)))
      .groupBy(complianceDecisions.decision);

    const todayMap = todayRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.decision] = Number(row.count ?? 0);
      return acc;
    }, {});
    const weekMap = weekRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.decision] = Number(row.count ?? 0);
      return acc;
    }, {});

    const blockedToday = todayMap.BLOCK ?? 0;
    const reviewToday = todayMap.MANUAL_REVIEW ?? 0;
    const blockedDailyAvg = Math.round((weekMap.BLOCK ?? 0) / 7);
    const reviewDailyAvg = Math.round((weekMap.MANUAL_REVIEW ?? 0) / 7);

    const alerts: Array<{ code: string; level: "info" | "warning"; message: string }> = [];
    if (blockedToday > Math.max(10, blockedDailyAvg * 2)) {
      alerts.push({
        code: "BLOCK_SPIKE",
        level: "warning",
        message: `Blocked decisions spiked today (${blockedToday}) vs 7-day avg (${blockedDailyAvg}).`,
      });
    }
    if (reviewToday > Math.max(10, reviewDailyAvg * 2)) {
      alerts.push({
        code: "MANUAL_REVIEW_SPIKE",
        level: "warning",
        message: `Manual-review decisions spiked today (${reviewToday}) vs 7-day avg (${reviewDailyAvg}).`,
      });
    }
    if (alerts.length === 0) {
      alerts.push({
        code: "COMPLIANCE_STABLE",
        level: "info",
        message: "No abnormal compliance decision spikes detected.",
      });
    }

    res.json({
      data: {
        today: {
          blocked: blockedToday,
          manualReview: reviewToday,
        },
        baselineDailyAvg: {
          blocked: blockedDailyAvg,
          manualReview: reviewDailyAvg,
        },
        alerts,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/assist/outbound-calls/pipeline ─────────────────────────────

router.get("/v1/assist/outbound-calls/pipeline", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), MAX_PAGE_SIZE);
    const offset = parseInt((req.query.offset as string) || "0", 10);

    const schemaMode = await getCallAttemptsSchemaMode();
    let rows;

    if (schemaMode === "modern") {
      rows = await db
        .select({
          id: callAttempts.id,
          prospectId: callAttempts.prospectId,
          phone: prospectsRaw.phone,
          businessName: prospectsRaw.businessName,
          status: callAttempts.status,
          outcome: callAttempts.outcome,
          attemptCount: callAttempts.attemptCount,
          maxAttempts: callAttempts.maxAttempts,
          nextAttemptAt: callAttempts.nextAttemptAt,
          lastAttemptAt: callAttempts.lastAttemptAt,
          callSid: callAttempts.callSid,
          dndAt: callAttempts.dndAt,
          createdAt: callAttempts.createdAt,
        })
        .from(callAttempts)
        .leftJoin(prospectsRaw, eq(callAttempts.prospectId, prospectsRaw.id))
        .where(
          and(
            eq(callAttempts.tenantId, tenantId),
            eq(callAttempts.direction, "outbound"),
          ),
        )
        .orderBy(desc(callAttempts.createdAt))
        .limit(limit)
        .offset(offset);
    } else {
      // Legacy schema fallback.
      rows = await db
        .select({
          id: callAttempts.id,
          prospectId: callAttempts.prospectId,
          phone: prospectsRaw.phone,
          businessName: prospectsRaw.businessName,
          outcome: callAttempts.outcome,
          callSid: callAttempts.callSid,
          createdAt: callAttempts.createdAt,
        })
        .from(callAttempts)
        .leftJoin(prospectsRaw, eq(callAttempts.prospectId, prospectsRaw.id))
        .where(eq(callAttempts.tenantId, tenantId))
        .orderBy(desc(callAttempts.createdAt))
        .limit(limit)
        .offset(offset)
        .then((legacyRows) => legacyRows.map((row) => ({
          ...row,
          status: "queued",
          attemptCount: 0,
          maxAttempts: 0,
          nextAttemptAt: null,
          lastAttemptAt: null,
          dndAt: null,
        })));
    }

    res.json({ data: rows, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/assist/outbound-calls/control ──────────────────────────────

router.get("/v1/assist/outbound-calls/control", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenant = await db.query.tenants.findFirst({
      where: and(eq(tenants.id, req.tenantId), eq(tenants.active, true)),
    });

    if (!tenant) {
      res.status(404).json({ error: "NOT_FOUND", message: "Tenant not found" });
      return;
    }

    const meta = (tenant.metadata as Record<string, unknown> | null) ?? {};
    const control = getOutboundControl(meta);

    res.json({
      data: {
        ...control,
        globalPaused: outboundGlobalPauseEnabled(),
        canManage: canManageOutbound(req),
        updatedAt: (meta.outbound_voice_updated_at as string) ?? null,
        updatedBy: (meta.outbound_voice_updated_by as string) ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/v1/assist/outbound-calls/control ────────────────────────────

router.patch("/v1/assist/outbound-calls/control", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManageOutbound(req)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Insufficient permissions for outbound controls" });
      return;
    }

    const tenant = await db.query.tenants.findFirst({
      where: and(eq(tenants.id, req.tenantId), eq(tenants.active, true)),
    });

    if (!tenant) {
      res.status(404).json({ error: "NOT_FOUND", message: "Tenant not found" });
      return;
    }

    const meta = (tenant.metadata as Record<string, unknown> | null) ?? {};
    const body = req.body as {
      enabled?: boolean;
      paused?: boolean;
      pausedReason?: string;
      maxConcurrentCalls?: number;
      drainQueued?: boolean;
    };

    const updatedMeta: Record<string, unknown> = {
      ...meta,
      ...(body.enabled !== undefined && { outbound_voice_enabled: Boolean(body.enabled) }),
      ...(body.paused !== undefined && { outbound_voice_paused: Boolean(body.paused) }),
      ...(body.pausedReason !== undefined && { outbound_voice_paused_reason: String(body.pausedReason).slice(0, 180) }),
      ...(body.maxConcurrentCalls !== undefined && {
        outbound_voice_max_concurrent_calls: Math.max(1, Math.min(Number(body.maxConcurrentCalls) || 1, 25)),
      }),
      outbound_voice_updated_at: new Date().toISOString(),
      outbound_voice_updated_by: req.userId,
    };

    await db
      .update(tenants)
      .set({
        metadata: updatedMeta,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, req.tenantId));

    let drained = 0;
    if (body.paused === true && body.drainQueued === true) {
      const drainedRows = await db
        .update(callAttempts)
        .set({
          status: "canceled",
          outcome: "canceled_admin_pause",
          nextAttemptAt: null,
        })
        .where(
          and(
            eq(callAttempts.tenantId, req.tenantId),
            eq(callAttempts.direction, "outbound"),
            inArray(callAttempts.status, ["queued", "retry_scheduled"]),
          ),
        )
        .returning({ id: callAttempts.id });
      drained = drainedRows.length;
    }

    res.json({ data: { ok: true, drained } });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/assist/outbound-calls/metrics ──────────────────────────────

router.get("/v1/assist/outbound-calls/metrics", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    const meta = (tenant?.metadata as Record<string, unknown> | null) ?? {};
    const control = getOutboundControl(meta);

    let grouped: Array<{ status: string | null; count: number }> = [];
    let recent: Array<{
      id: string;
      status: string;
      outcome: string | null;
      attemptCount: number;
      maxAttempts: number;
      nextAttemptAt: Date | null;
      createdAt: Date;
    }> = [];

    const schemaMode = await getCallAttemptsSchemaMode();

    if (schemaMode === "modern") {
      grouped = await db
        .select({
          status: callAttempts.status,
          count: sql<number>`count(*)`,
        })
        .from(callAttempts)
        .where(
          and(
            eq(callAttempts.tenantId, tenantId),
            eq(callAttempts.direction, "outbound"),
          ),
        )
        .groupBy(callAttempts.status);

      recent = await db
        .select({
          id: callAttempts.id,
          status: callAttempts.status,
          outcome: callAttempts.outcome,
          attemptCount: callAttempts.attemptCount,
          maxAttempts: callAttempts.maxAttempts,
          nextAttemptAt: callAttempts.nextAttemptAt,
          createdAt: callAttempts.createdAt,
        })
        .from(callAttempts)
        .where(
          and(
            eq(callAttempts.tenantId, tenantId),
            eq(callAttempts.direction, "outbound"),
          ),
        )
        .orderBy(desc(callAttempts.createdAt))
        .limit(30);
    } else {
      const legacyRecent = await db
        .select({
          id: callAttempts.id,
          outcome: callAttempts.outcome,
          createdAt: callAttempts.createdAt,
        })
        .from(callAttempts)
        .where(eq(callAttempts.tenantId, tenantId))
        .orderBy(desc(callAttempts.createdAt))
        .limit(30);

      grouped = [{ status: "queued", count: legacyRecent.length }];
      recent = legacyRecent.map((row) => ({
        id: row.id,
        status: "queued",
        outcome: row.outcome,
        attemptCount: 0,
        maxAttempts: 0,
        nextAttemptAt: null,
        createdAt: row.createdAt,
      }));
    }

    const statusCounts = grouped.reduce<Record<string, number>>((acc, row) => {
      acc[row.status ?? "unknown"] = Number(row.count ?? 0);
      return acc;
    }, {});

    const retryScheduled = statusCounts.retry_scheduled ?? 0;
    const queued = statusCounts.queued ?? 0;
    const active = (statusCounts.dialing ?? 0) + (statusCounts.ringing ?? 0) + (statusCounts.answered ?? 0);
    const completed = statusCounts.completed ?? 0;
    const dnd = statusCounts.dnd ?? 0;
    const blocked = statusCounts.blocked_compliance ?? 0;

    res.json({
      data: {
        totals: {
          queued,
          retryScheduled,
          active,
          completed,
          dnd,
          blocked,
          total: grouped.reduce((sum, row) => sum + Number(row.count ?? 0), 0),
        },
        capacity: {
          maxConcurrentCalls: control.maxConcurrentCalls,
          active,
          availableSlots: Math.max(0, control.maxConcurrentCalls - active),
        },
        statusCounts,
        recent,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/assist/outbound-calls/cancel/:callAttemptId ──────────────

router.post("/v1/assist/outbound-calls/cancel/:callAttemptId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const callAttemptId = req.params.callAttemptId;

    const [updated] = await db
      .update(callAttempts)
      .set({
        status: "canceled",
        outcome: "canceled_by_user",
        nextAttemptAt: null,
      })
      .where(
        and(
          eq(callAttempts.tenantId, tenantId),
          eq(callAttempts.id, callAttemptId),
          eq(callAttempts.direction, "outbound"),
        ),
      )
      .returning({ id: callAttempts.id, status: callAttempts.status, outcome: callAttempts.outcome });

    if (!updated) {
      res.status(404).json({ error: "NOT_FOUND", message: "Outbound call attempt not found" });
      return;
    }

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// ─── PUBLIC ROUTES (no Clerk auth, validates tenantId from DB) ──────────────

// POST /api/v1/assist/chat — widget chat (public, no auth)
publicRouter.post("/chat", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantIdFromBody = String(req.body?.tenantId ?? "").trim();
    if (!tenantIdFromBody) {
      res.status(400).json({ error: "INVALID_INPUT", message: "tenantId is required" });
      return;
    }
    if (!isUuid(tenantIdFromBody)) {
      res.status(400).json({ error: "INVALID_INPUT", message: "tenantId must be a valid UUID" });
      return;
    }

    // Validate tenantId exists in DB
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantIdFromBody),
    });
    if (!tenant) {
      res.status(404).json({ error: "NOT_FOUND", message: "Tenant not found" });
      return;
    }

    const widgetAccessError = validateWidgetAccess(req, tenant);
    if (widgetAccessError) {
      res.status(403).json({ error: "FORBIDDEN", message: widgetAccessError });
      return;
    }

    const rateLimitError = await enforcePublicRateLimit(req, tenant.id);
    if (rateLimitError) {
      res.status(429).json({ error: "RATE_LIMITED", message: rateLimitError });
      return;
    }

    const tenantMeta = getTenantMetadata(tenant);
    const agentProfile = resolveTenantAgentProfiles(tenant.metadata)[resolveAssistantMode({ channel: "chat" })];
    if (!agentProfile.enabled) {
      res.status(403).json({ error: "AGENT_DISABLED", message: "Chat assistant is disabled for this tenant" });
      return;
    }
    const publicBudgetError = await enforcePublicDailyBudget({
      tenantId: tenant.id,
      bucket: "chat",
      limit: getPositiveInteger(tenantMeta, "widget_daily_message_limit", DEFAULT_WIDGET_DAILY_MESSAGE_LIMIT),
    });
    if (publicBudgetError) {
      res.status(429).json({ error: "PUBLIC_LIMIT_REACHED", message: publicBudgetError });
      return;
    }

    const tenantId = tenantIdFromBody;
    const message = String(req.body?.message ?? "").trim();
    const sessionId = req.body?.sessionId ? String(req.body.sessionId) : undefined;
    const history = Array.isArray(req.body?.history)
      ? req.body.history
          .map((m: any) => ({ role: m?.role === "assistant" ? "assistant" : "user", content: String(m?.content ?? "") }))
          .filter((m: any) => m.content.trim().length > 0)
      : [];

    if (!message) {
      res.status(400).json({ error: "INVALID_INPUT", message: "message is required" });
      return;
    }

    const contact = (req.body?.contact ?? {}) as { name?: string; phone?: string; email?: string };
    const consent = (req.body?.consent ?? null) as ConsentPayload | null;

    if (isOptOutText(message)) {
      const suppressed = await createSuppressionAndRevokeConsent({
        tenantId,
        phone: contact.phone,
        email: contact.email,
        suppressionType: "stop_reply",
        reason: "chat_opt_out",
      });

      res.json({
        data: {
          sessionId: sessionId ?? null,
          reply: suppressed
            ? "Understood. You are opted out and we will not contact you again."
            : "Understood. Please share the phone or email you'd like us to opt out.",
          escalated: false,
          escalate: false,
          escalationReason: null,
          status: "resolved",
        },
      });
      return;
    }

    const prospect = await getOrCreateProspect({
      tenantId,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
    });
    await captureConsentEvidence({
      tenantId,
      prospectId: prospect.id,
      phone: contact.phone ?? prospect.phone,
      sellerName: tenant.name,
      consent,
      req,
    });

    const result = await runClientAssistant({
      tenantId,
      sessionId,
      message,
      history,
      sessionType: "website_widget",
      prospectId: prospect.id,
      contactName: contact.name,
      contactEmail: contact.email,
      contactPhone: contact.phone,
      assistantMode: "chat",
      behaviorHint: `${agentProfile.behaviorHint}${agentProfile.allowBooking ? "" : " Booking actions are disabled in this mode."}${agentProfile.allowEscalation ? "" : " Escalation actions are disabled in this mode."}`,
      runId: req.body?.runId ? String(req.body.runId) : undefined,
    });

    if (!result.ok) {
      res.status(400).json(result);
      return;
    }

    if (!agentProfile.allowBooking && result.data.intent === "booking_intent") {
      result.data.reply = "Booking is currently handled by our team. Please share your preferred day and time and we will follow up.";
      result.data.bookingId = undefined;
    }
    if (!agentProfile.allowEscalation && result.data.escalate) {
      result.data.escalate = false;
      result.data.escalationReason = undefined;
    }

    // Escalation path: fire-and-forget notifications when agent detects escalation
    if (result.data.escalate) {
      const meta = (tenant.metadata as Record<string, unknown>) ?? {};
      triggerEscalationNotifications({
        tenantId,
        sessionId: result.data.sessionId,
        prospectName: contact.name ?? prospect.businessName ?? "Website Visitor",
        prospectPhone: contact.phone ?? prospect.phone ?? null,
        escalationContactPhone: (tenant.escalationContactPhone ?? (meta.escalationContactPhone as string | undefined) ?? null),
        escalationContactEmail: (tenant.escalationContactEmail ?? (meta.escalationContactEmail as string | undefined) ?? null),
        fromNumber: tenant.voiceNumber ?? (meta.voiceNumber as string | undefined) ?? null,
        escalationReason: result.data.escalationReason,
        appBaseUrl: process.env.APP_BASE_URL,
      });
    }

    const channel = req.body?.channel === "email" ? "email" : "chat";

    const [msg] = await db
      .insert(messageAttempts)
      .values({
        tenantId,
        prospectId: prospect.id,
        channel,
        direction: "outbound",
        messageText: result.data.reply,
        status: "pending_approval",
      })
      .returning({ id: messageAttempts.id });

    void publishRealtimeEvent({
      type: "new_pending_approval",
      tenantId,
      payload: {
        messageId: msg.id,
        channel,
        prospectId: prospect.id,
        customer: contact.name ?? prospect.businessName ?? "Website Visitor",
        sessionId: result.data.sessionId,
      },
    }).catch((err) => {
      console.error("[assist/chat] realtime publish failed:", err);
    });

    res.json({
      data: {
        ...result.data,
        messageId: msg.id,
        status: "pending_approval",
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/assist/missed-call — missed call SMS (public, no auth)
publicRouter.post("/missed-call", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantIdFromBody = String(req.body?.tenantId ?? "").trim();
    if (!tenantIdFromBody) {
      res.status(400).json({ error: "INVALID_INPUT", message: "tenantId is required" });
      return;
    }
    if (!isUuid(tenantIdFromBody)) {
      res.status(400).json({ error: "INVALID_INPUT", message: "tenantId must be a valid UUID" });
      return;
    }

    // Validate tenantId exists in DB
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantIdFromBody),
    });
    if (!tenant) {
      res.status(404).json({ error: "NOT_FOUND", message: "Tenant not found" });
      return;
    }

    const widgetAccessError = validateWidgetAccess(req, tenant);
    if (widgetAccessError) {
      res.status(403).json({ error: "FORBIDDEN", message: widgetAccessError });
      return;
    }

    const rateLimitError = await enforcePublicRateLimit(req, tenant.id);
    if (rateLimitError) {
      res.status(429).json({ error: "RATE_LIMITED", message: rateLimitError });
      return;
    }

    const tenantId = tenantIdFromBody;
    const phone = String(req.body?.phone ?? "").trim();
    const name = String(req.body?.name ?? "").trim() || "Caller";

    if (!phone) {
      res.status(400).json({ error: "INVALID_INPUT", message: "phone is required" });
      return;
    }

    const tenantMeta = getTenantMetadata(tenant);
    const publicBudgetError = await enforcePublicDailyBudget({
      tenantId,
      bucket: "missed_call",
      limit: getPositiveInteger(tenantMeta, "widget_daily_missed_call_limit", DEFAULT_WIDGET_DAILY_MISSED_CALL_LIMIT),
    });
    if (publicBudgetError) {
      res.status(429).json({ error: "PUBLIC_LIMIT_REACHED", message: publicBudgetError });
      return;
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone || !normalizedPhone.startsWith("+") || normalizedPhone.length < 10) {
      res.status(400).json({ error: "INVALID_INPUT", message: "phone must be in E.164 format" });
      return;
    }

    const cooldownError = await enforceMissedCallCooldown(tenantId, normalizedPhone);
    if (cooldownError) {
      res.status(429).json({ error: "RATE_LIMITED", message: cooldownError });
      return;
    }

    const prospect = await getOrCreateProspect({ tenantId, name, phone: normalizedPhone });
    const consent = (req.body?.consent ?? null) as ConsentPayload | null;
    await captureConsentEvidence({
      tenantId,
      prospectId: prospect.id,
      phone: normalizedPhone,
      sellerName: tenant.name,
      consent,
      req,
    });

    const [session] = await db
      .insert(assistantSessions)
      .values({
        tenantId,
        prospectId: prospect.id,
        sessionType: "missed_call_sms",
      })
      .returning({ id: assistantSessions.id });

    const text = `Hi ${name}, sorry we missed your call. How can we help today? Reply STOP to opt out.`;

    const [msg] = await db
      .insert(messageAttempts)
      .values({
        tenantId,
        prospectId: prospect.id,
        channel: "sms",
        direction: "outbound",
        messageText: text,
        status: "pending_approval",
      })
      .returning({ id: messageAttempts.id });

    // Auto-send path: if tenant has auto_send_missed_call enabled, send SMS via SignalWire now
    let finalStatus: "pending_approval" | "sent" | "failed" = "pending_approval";
    if (tenant.autoSendMissedCall) {
      const fromNumber = tenant.voiceNumber ?? (tenant.metadata as Record<string, unknown>)?.voiceNumber as string | undefined;
      const projectId = process.env.SIGNALWIRE_PROJECT_ID;
      const apiToken  = process.env.SIGNALWIRE_API_TOKEN;
      const spaceUrl  = (process.env.SIGNALWIRE_SPACE_URL ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");

      if (fromNumber && projectId && apiToken && spaceUrl) {
        try {
          const form = new URLSearchParams();
          form.set("To",   normalizedPhone);
          form.set("From", fromNumber);
          form.set("Body", text);

          const swRes = await fetch(
            `https://${spaceUrl}/api/laml/2010-04-01/Accounts/${encodeURIComponent(projectId)}/Messages.json`,
            {
              method: "POST",
              headers: {
                Authorization: `Basic ${Buffer.from(`${projectId}:${apiToken}`).toString("base64")}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: form.toString(),
            },
          );

          let sendStatus: "sent" | "failed";
          if (swRes.ok) {
            sendStatus = "sent";
          } else {
            const errBody = await swRes.text();
            console.error(`[missed-call] SignalWire SMS failed ${swRes.status}: ${errBody.slice(0, 200)}`);
            sendStatus = "failed";
          }
          finalStatus = sendStatus;
        } catch (sendErr) {
          console.error("[missed-call] SignalWire SMS send error:", sendErr);
          finalStatus = "failed";
        }

        await db
          .update(messageAttempts)
          .set({ status: finalStatus })
          .where(eq(messageAttempts.id, msg.id));
      } else {
        console.warn("[missed-call] auto_send_missed_call is true but voice number or SignalWire env vars are missing — leaving pending_approval");
      }
    }

    if (finalStatus === "pending_approval") {
      void publishRealtimeEvent({
        type: "new_pending_approval",
        tenantId,
        payload: {
          messageId: msg.id,
          channel: "sms",
          prospectId: prospect.id,
          customer: name,
          sessionId: session.id,
        },
      }).catch((err) => {
        console.error("[assist/missed-call] realtime publish failed:", err);
      });
    }

    res.json({
      data: {
        sessionId: session.id,
        messageId: msg.id,
        status: finalStatus,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/assist/escalations ──────────────────────────────────────────
// Returns recent escalated sessions for the client portal dashboard.

router.get("/escalations", rateLimit("general"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const limit  = Math.min(parseInt((req.query.limit  as string) || "25", 10), 50);
    const offset = parseInt((req.query.offset as string) || "0", 10);

    const rows = await db
      .select({
        id:               assistantSessions.id,
        sessionType:      assistantSessions.sessionType,
        escalationReason: assistantSessions.escalationReason,
        createdAt:        assistantSessions.createdAt,
        prospectId:       assistantSessions.prospectId,
        prospectPhone:    prospectsRaw.phone,
        prospectName:     prospectsRaw.businessName,
      })
      .from(assistantSessions)
      .leftJoin(prospectsRaw, eq(assistantSessions.prospectId, prospectsRaw.id))
      .where(and(eq(assistantSessions.tenantId, tenantId), eq(assistantSessions.escalated, true)))
      .orderBy(desc(assistantSessions.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ data: rows, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/assist/analytics ───────────────────────────────────────────
// Returns the last N days of daily summaries for analytics dashboard charts.

router.get("/analytics", rateLimit("general"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const days = Math.max(1, Math.min(parseInt((req.query.days as string) || "30", 10), 90));
    const cutoff = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const rows = await db
      .select({
        date: dailySummaries.date,
        newProspectsCount: dailySummaries.newProspectsCount,
        pendingApprovalCount: dailySummaries.pendingApprovalCount,
        approvedCount: dailySummaries.approvedCount,
        blockedCount: dailySummaries.blockedCount,
        callsHandledCount: dailySummaries.callsHandledCount,
        appointmentsBookedCount: dailySummaries.appointmentsBookedCount,
        escalationsCount: dailySummaries.escalationsCount,
        questionsCount: dailySummaries.questionsCount,
        avgUrgencyScore: dailySummaries.avgUrgencyScore,
      })
      .from(dailySummaries)
      .where(and(eq(dailySummaries.tenantId, tenantId), gte(dailySummaries.date, cutoff)))
      .orderBy(dailySummaries.date);

    const totals = rows.reduce(
      (acc, row) => {
        acc.callsHandled += Number(row.callsHandledCount ?? 0);
        acc.appointmentsBooked += Number(row.appointmentsBookedCount ?? 0);
        acc.escalations += Number(row.escalationsCount ?? 0);
        acc.urgencySum += Number(row.avgUrgencyScore ?? 0);
        if (row.avgUrgencyScore !== null && row.avgUrgencyScore !== undefined) {
          acc.urgencyDays += 1;
        }
        return acc;
      },
      { callsHandled: 0, appointmentsBooked: 0, escalations: 0, urgencySum: 0, urgencyDays: 0 },
    );

    res.json({
      data: {
        days,
        rows,
        totals: {
          callsHandled: totals.callsHandled,
          appointmentsBooked: totals.appointmentsBooked,
          escalations: totals.escalations,
          avgUrgencyScore: totals.urgencyDays > 0 ? Math.round(totals.urgencySum / totals.urgencyDays) : null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/appointments/manual ──────────────────────────────────────────
// Staff creates a manual booking from the Assist portal.
// Requires role: owner | admin | operator.

router.post("/appointments/manual", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.userId;

    if (!OUTBOUND_CONTROL_ROLES.has(req.userRole)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Insufficient permissions" });
      return;
    }

    const body = req.body as {
      prospectId?: string;
      callerName?: string;
      callerPhone?: string;
      callerEmail?: string;
      service?: string;
      startAt?: string;
      endAt?: string;
      notes?: string;
    };

    const callerName = String(body.callerName ?? "").trim() || "Unknown";
    const callerPhone = normalizePhone(body.callerPhone ?? "");
    const callerEmail = String(body.callerEmail ?? "").trim() || undefined;
    const service = String(body.service ?? "").trim() || undefined;
    const notes = String(body.notes ?? "").trim() || undefined;

    if (!body.startAt) {
      res.status(400).json({ error: "INVALID_INPUT", message: "startAt is required" });
      return;
    }

    const startAt = new Date(body.startAt);
    if (isNaN(startAt.getTime())) {
      res.status(400).json({ error: "INVALID_INPUT", message: "startAt is not a valid date" });
      return;
    }

    const endAt = body.endAt
      ? new Date(body.endAt)
      : new Date(startAt.getTime() + 60 * 60 * 1000);

    if (isNaN(endAt.getTime()) || endAt <= startAt) {
      res.status(400).json({ error: "INVALID_INPUT", message: "endAt must be a valid date after startAt" });
      return;
    }

    // Find or create prospect
    let prospectId = String(body.prospectId ?? "").trim();
    if (!prospectId) {
      if (!callerPhone && !callerEmail) {
        res.status(400).json({ error: "INVALID_INPUT", message: "prospectId or callerPhone/callerEmail is required" });
        return;
      }
      const prospect = await getOrCreateProspect({
        tenantId,
        name: callerName,
        phone: callerPhone || undefined,
        email: callerEmail,
      });
      prospectId = prospect.id;
    } else {
      // Verify the provided prospectId belongs to this tenant
      const prospect = await db.query.prospectsRaw.findFirst({
        where: and(eq(prospectsRaw.id, prospectId), eq(prospectsRaw.tenantId, tenantId)),
      });
      if (!prospect) {
        res.status(404).json({ error: "NOT_FOUND", message: "Prospect not found" });
        return;
      }
    }

    const result = await executeBooking({
      tenantId,
      prospectId,
      callerName,
      callerPhone,
      callerEmail,
      service,
      startAt,
      endAt,
      channel: "manual",
      notes,
      createdBy: userId,
    });

    if (result.status === "error") {
      res.status(500).json({ error: "BOOKING_ERROR", message: "Booking failed — check server logs" });
      return;
    }

    logAudit({
      req,
      tenantId,
      userId,
      action: "appointments.create_manual",
      resourceType: "appointment",
      resourceId: result.appointmentId,
    });

    res.status(201).json({ data: { appointmentId: result.appointmentId, status: result.status } });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/appointments/:id ─────────────────────────────────────────────
// Update appointment status (confirm, cancel, complete).

router.patch("/appointments/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const appointmentId = req.params.id;
    const status = String(req.body?.status ?? "").trim();

    const allowed = ["confirmed", "cancelled", "completed", "no_show"];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: "INVALID_INPUT", message: `status must be one of: ${allowed.join(", ")}` });
      return;
    }

    const [updated] = await db
      .update(appointments)
      .set({ status })
      .where(and(eq(appointments.tenantId, tenantId), eq(appointments.id, appointmentId)))
      .returning({ id: appointments.id, status: appointments.status });

    if (!updated) {
      res.status(404).json({ error: "NOT_FOUND", message: "Appointment not found" });
      return;
    }

    logAudit({
      req,
      tenantId,
      userId: req.userId,
      action: "appointments.status_update",
      resourceType: "appointment",
      resourceId: updated.id,
    });

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/assist/blackout-blocks ──────────────────────────────────────

router.get("/v1/assist/blackout-blocks", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), MAX_PAGE_SIZE);
    const offset = parseInt((req.query.offset as string) || "0", 10);

    // Optional: only return upcoming/active blocks by default
    const includeExpired = req.query.expired === "true";
    const now = new Date();

    const rows = await db
      .select({
        id: blackoutBlocks.id,
        label: blackoutBlocks.label,
        startAt: blackoutBlocks.startAt,
        endAt: blackoutBlocks.endAt,
        notes: blackoutBlocks.notes,
        createdAt: blackoutBlocks.createdAt,
      })
      .from(blackoutBlocks)
      .where(
        includeExpired
          ? eq(blackoutBlocks.tenantId, tenantId)
          : and(eq(blackoutBlocks.tenantId, tenantId), gte(blackoutBlocks.endAt, now)),
      )
      .orderBy(blackoutBlocks.startAt)
      .limit(limit)
      .offset(offset);

    res.json({ data: rows, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/assist/blackout-blocks ─────────────────────────────────────

router.post("/v1/assist/blackout-blocks", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.userId;

    if (!OUTBOUND_CONTROL_ROLES.has(req.userRole)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Insufficient permissions" });
      return;
    }

    const label = String(req.body?.label ?? "").trim();
    const notes = String(req.body?.notes ?? "").trim() || undefined;

    if (!label) {
      res.status(400).json({ error: "INVALID_INPUT", message: "label is required" });
      return;
    }
    if (!req.body?.startAt || !req.body?.endAt) {
      res.status(400).json({ error: "INVALID_INPUT", message: "startAt and endAt are required" });
      return;
    }

    const startAt = new Date(req.body.startAt as string);
    const endAt = new Date(req.body.endAt as string);

    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
      res.status(400).json({ error: "INVALID_INPUT", message: "startAt and endAt must be valid dates" });
      return;
    }
    if (endAt <= startAt) {
      res.status(400).json({ error: "INVALID_INPUT", message: "endAt must be after startAt" });
      return;
    }

    // Fire writeback to external calendar (non-blocking — failure is logged, not surfaced)
    const providerBlockId = await attemptBlackoutWriteback({
      tenantId,
      label,
      startAt,
      endAt,
      notes,
    }).catch(() => null);

    const [block] = await db
      .insert(blackoutBlocks)
      .values({ tenantId, label, startAt, endAt, notes, providerBlockId, createdBy: userId })
      .returning({
        id: blackoutBlocks.id,
        label: blackoutBlocks.label,
        startAt: blackoutBlocks.startAt,
        endAt: blackoutBlocks.endAt,
        notes: blackoutBlocks.notes,
        providerBlockId: blackoutBlocks.providerBlockId,
        createdAt: blackoutBlocks.createdAt,
      });

    logAudit({
      req,
      tenantId,
      userId,
      action: "blackout_blocks.create",
      resourceType: "blackout_block",
      resourceId: block.id,
    });

    res.status(201).json({ data: block });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/v1/assist/blackout-blocks/:id ───────────────────────────────

router.delete("/v1/assist/blackout-blocks/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const blockId = req.params.id;

    if (!OUTBOUND_CONTROL_ROLES.has(req.userRole)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Insufficient permissions" });
      return;
    }

    const [deleted] = await db
      .delete(blackoutBlocks)
      .where(and(eq(blackoutBlocks.tenantId, tenantId), eq(blackoutBlocks.id, blockId)))
      .returning({ id: blackoutBlocks.id, providerBlockId: blackoutBlocks.providerBlockId });

    if (!deleted) {
      res.status(404).json({ error: "NOT_FOUND", message: "Blackout block not found" });
      return;
    }

    // Fire cancel writeback if this block was synced to an external calendar
    if (deleted.providerBlockId) {
      void attemptBlackoutCancelWriteback({
        tenantId,
        providerBlockId: deleted.providerBlockId,
      }).catch((err) =>
        console.warn("[assist/blackout-blocks] cancel writeback failed:", err),
      );
    }

    logAudit({
      req,
      tenantId,
      userId: req.userId,
      action: "blackout_blocks.delete",
      resourceType: "blackout_block",
      resourceId: deleted.id,
    });

    res.json({ data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
export { publicRouter as assistPublicRouter };
