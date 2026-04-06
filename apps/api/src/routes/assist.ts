// QYRO Assist routes — Session N
// Auth + tenant scoping applied upstream.
//
// Routes:
//   GET  /api/sessions      — list assistant_sessions for tenant (paginated)
//   GET  /api/appointments  — list appointments for tenant (paginated)

import { Router, type Request, type Response, type NextFunction, type Router as ExpressRouter } from "express";
import { rateLimit } from "../middleware/rateLimit";
import { logAudit } from "../lib/auditLog";

const MAX_PAGE_SIZE = 50;
import { db } from "@qyro/db";
import { assistantSessions, appointments, prospectsRaw, messageAttempts, callAttempts, tenants, tenantSubscriptions } from "@qyro/db";
import { eq, and, desc, sql, inArray, or } from "drizzle-orm";
import { runClientAssistant } from "@qyro/agents/clientAssistant";
import { outboundCallQueue, redis } from "@qyro/queue";
import { resolveTenantBaseAccess, resolveTrialState } from "../lib/entitlements";

const router: ExpressRouter = Router();
const publicRouter: ExpressRouter = Router();
const OUTBOUND_CONTROL_ROLES = new Set(["owner", "admin", "operator"]);
const PUBLIC_RATE_WINDOW_SEC = 60;
const PUBLIC_RATE_LIMIT = 30;
const CALL_ATTEMPTS_SCHEMA_TTL_MS = 60_000;

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
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
  return forwarded || req.ip || "unknown";
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
        direction:    callAttempts.direction,
        status:       callAttempts.status,
        duration:     callAttempts.duration,
        outcome:      callAttempts.outcome,
        createdAt:    callAttempts.createdAt,
        // recordingUrl and transcriptUrl omitted from list — fetch via detail endpoint
      })
      .from(callAttempts)
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
    const schemaMode = await getCallAttemptsSchemaMode();
    const legacyMode = schemaMode === "legacy";

    for (const prospectId of prospectSet) {
      const prospect = await db.query.prospectsRaw.findFirst({
        where: and(eq(prospectsRaw.id, prospectId), eq(prospectsRaw.tenantId, tenantId)),
      });

      if (!prospect || !normalizePhone(prospect.phone)) continue;

      let attemptId: string;
      if (schemaMode === "modern") {
        const [attempt] = await db
          .insert(callAttempts)
          .values({
            tenantId,
            prospectId,
            direction: "outbound",
            source: "lead_manual",
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
        legacyMode,
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

    // Validate tenantId exists in DB
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantIdFromBody),
    });
    if (!tenant) {
      res.status(404).json({ error: "NOT_FOUND", message: "Tenant not found" });
      return;
    }

    const originError = validateWidgetOrigin(req, tenant);
    if (originError) {
      res.status(403).json({ error: "FORBIDDEN", message: originError });
      return;
    }

    const rateLimitError = await enforcePublicRateLimit(req, tenant.id);
    if (rateLimitError) {
      res.status(429).json({ error: "RATE_LIMITED", message: rateLimitError });
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
    const prospect = await getOrCreateProspect({
      tenantId,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
    });

    const result = await runClientAssistant({
      tenantId,
      sessionId,
      message,
      history,
      sessionType: "website_widget",
      runId: req.body?.runId ? String(req.body.runId) : undefined,
    });

    if (!result.ok) {
      res.status(400).json(result);
      return;
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

    // Validate tenantId exists in DB
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantIdFromBody),
    });
    if (!tenant) {
      res.status(404).json({ error: "NOT_FOUND", message: "Tenant not found" });
      return;
    }

    const originError = validateWidgetOrigin(req, tenant);
    if (originError) {
      res.status(403).json({ error: "FORBIDDEN", message: originError });
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

    const prospect = await getOrCreateProspect({ tenantId, name, phone });

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
          form.set("To",   phone);
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

export default router;
export { publicRouter as assistPublicRouter };
