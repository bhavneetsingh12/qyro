// QYRO Tenants routes — Session O
// Auth + tenant scoping applied upstream.
//
// Routes:
//   GET   /api/v1/tenants/settings  — return name + metadata fields for this tenant
//   PATCH /api/v1/tenants/settings  — update name + metadata fields

import { Router, type Request, type Response, type NextFunction, type Router as ExpressRouter } from "express";
import { eq } from "drizzle-orm";
import { db, tenantSubscriptions, tenants, users } from "@qyro/db";
import { isMasterAdminUser, isTenantManagerRole, resolveEffectiveAccessForUser, resolveTenantBaseAccess, resolveTrialState } from "../lib/entitlements";

const router: ExpressRouter = Router();

function normalizePhone(value?: string): string {
  return (value ?? "").replace(/[^+\d]/g, "").trim();
}

function maskApiKey(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(value.length - 8)}${value.slice(-4)}`;
}

function requireTenantManager(req: Request, res: Response): boolean {
  if (isTenantManagerRole(req.userRole)) {
    return true;
  }

  res.status(403).json({
    error: "FORBIDDEN",
    message: "Only tenant owners or admins can manage user permissions",
  });
  return false;
}

// ─── GET /api/v1/tenants/settings ─────────────────────────────────────────────

router.get("/settings", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, req.tenantId),
    });

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const meta = (tenant.metadata as Record<string, unknown>) ?? {};
    const apolloApiKey = (meta.apolloApiKey as string) ?? "";
    const hunterApiKey = (meta.hunterApiKey as string) ?? "";
    const subscription = await db.query.tenantSubscriptions.findFirst({
      where: eq(tenantSubscriptions.tenantId, req.tenantId),
    });

    const resolvedAccess = resolveEffectiveAccessForUser({
      meta,
      subscription,
      userId: req.userId,
    });

    const tenantBaseAccess = resolveTenantBaseAccess(meta, subscription);
    const trial = resolveTrialState(meta);
    const currentUser = await db.query.users.findFirst({ where: eq(users.id, req.userId) });
    const isMasterAdmin = isMasterAdminUser({
      role: req.userRole,
      clerkId: currentUser?.clerkId ?? "",
      email: currentUser?.email ?? null,
    });
    const productAccess = isMasterAdmin
      ? { lead: true, assist: true }
      : resolvedAccess;

    const voiceNumber =
      tenant.voiceNumber
      ?? (meta.voiceNumber as string)
      ?? (meta.voice_number as string)
      ?? "";

    res.json({
      id:               tenant.id,
      name:             tenant.name,
      approvedServices: (meta.approvedServices as string) ?? "",
      bookingLink:      (meta.bookingLink as string) ?? "",
      emailFromName:    (meta.emailFromName as string) ?? "",
      calendarProvider: (meta.calendarProvider as string) ?? "cal_com",
      providersList:    (meta.providersList as string) ?? "",
      autoRespond:      Boolean(meta.autoRespond ?? false),
      businessHours:    (meta.businessHours as string) ?? "",
      voiceNumber,
      widgetAllowedOrigins: Array.isArray(meta.widget_allowed_origins)
        ? meta.widget_allowed_origins
        : typeof meta.widgetAllowedOrigins === "string"
          ? meta.widgetAllowedOrigins
          : "",
      voiceRuntime: (meta.voice_runtime as string) ?? "signalwire",
      retellAgentId: (meta.retell_agent_id as string) ?? "",
      enrichmentProvider:    (meta.enrichmentProvider as string) ?? "mock",
      hasApolloApiKey:       !!apolloApiKey,
      hasHunterApiKey:       !!hunterApiKey,
      apolloApiKeyMasked:    apolloApiKey ? maskApiKey(apolloApiKey) : "",
      hunterApiKeyMasked:    hunterApiKey ? maskApiKey(hunterApiKey) : "",
      enrichmentMonthlyLimit: Number(meta.enrichmentMonthlyLimit ?? 2500),
      enrichmentMonthlyUsed:  Number(meta.enrichmentMonthlyUsed ?? 0),
      productAccess,
      tenantBaseAccess,
      trial,
      currentUserRole: req.userRole,
      isMasterAdmin,
      showBillingStatus: !isMasterAdmin,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/v1/tenants/settings ───────────────────────────────────────────

router.patch("/settings", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      name,
      approvedServices,
      bookingLink,
      emailFromName,
      calendarProvider,
      providersList,
      autoRespond,
      businessHours,
      voiceNumber,
      widgetAllowedOrigins,
      voiceRuntime,
      retellAgentId,
      enrichmentProvider,
      apolloApiKey,
      hunterApiKey,
      enrichmentMonthlyLimit,
    } = req.body as {
      name?:             string;
      approvedServices?: string;
      bookingLink?:      string;
      emailFromName?:    string;
      calendarProvider?: "cal_com" | "google_calendar";
      providersList?: string;
      autoRespond?: boolean;
      businessHours?: string;
      voiceNumber?: string;
      widgetAllowedOrigins?: string | string[];
      voiceRuntime?: "signalwire" | "retell";
      retellAgentId?: string;
      enrichmentProvider?: "mock" | "apollo" | "hunter";
      apolloApiKey?: string;
      hunterApiKey?: string;
      enrichmentMonthlyLimit?: number;
    };

    const existing = await db.query.tenants.findFirst({
      where: eq(tenants.id, req.tenantId),
    });

    if (!existing) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const existingMeta = (existing.metadata as Record<string, unknown>) ?? {};

    const updatedMeta: Record<string, unknown> = {
      ...existingMeta,
      ...(approvedServices !== undefined && { approvedServices }),
      ...(bookingLink      !== undefined && { bookingLink }),
      ...(emailFromName    !== undefined && { emailFromName }),
      ...(calendarProvider !== undefined && { calendarProvider }),
      ...(providersList    !== undefined && { providersList }),
      ...(autoRespond      !== undefined && { autoRespond: Boolean(autoRespond) }),
      ...(businessHours    !== undefined && { businessHours }),
      ...(voiceNumber !== undefined && {
        voiceNumber,
        voice_number: voiceNumber,
      }),
      ...(widgetAllowedOrigins !== undefined && {
        widget_allowed_origins: Array.isArray(widgetAllowedOrigins)
          ? widgetAllowedOrigins.map((value) => String(value).trim()).filter(Boolean)
          : String(widgetAllowedOrigins)
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
      }),
      ...(voiceRuntime !== undefined && { voice_runtime: voiceRuntime === "retell" ? "retell" : "signalwire" }),
      ...(retellAgentId !== undefined && { retell_agent_id: retellAgentId.trim() }),
      ...(enrichmentProvider !== undefined && { enrichmentProvider }),
      ...(apolloApiKey !== undefined && apolloApiKey.trim().length > 0 && { apolloApiKey: apolloApiKey.trim() }),
      ...(hunterApiKey !== undefined && hunterApiKey.trim().length > 0 && { hunterApiKey: hunterApiKey.trim() }),
      ...(enrichmentMonthlyLimit !== undefined && {
        enrichmentMonthlyLimit: Math.max(0, Number(enrichmentMonthlyLimit) || 0),
      }),
    };

    await db
      .update(tenants)
      .set({
        ...(name !== undefined && { name: name.trim() }),
        ...(voiceNumber !== undefined && {
          voiceNumber: normalizePhone(voiceNumber) || null,
        }),
        metadata:  updatedMeta,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, req.tenantId));

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/tenants/users ───────────────────────────────────────────────

router.get("/users", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!requireTenantManager(req, res)) return;

    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, req.tenantId) });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const meta = (tenant.metadata as Record<string, unknown>) ?? {};
    const userAccessMap = (meta.user_product_access as Record<string, unknown> | undefined) ?? {};
    const subscription = await db.query.tenantSubscriptions.findFirst({
      where: eq(tenantSubscriptions.tenantId, req.tenantId),
    });

    const rows = await db.query.users.findMany({ where: eq(users.tenantId, req.tenantId) });
    const data = rows.map((u) => ({
      id: u.id,
      clerkId: u.clerkId,
      email: u.email,
      name: u.name,
      role: u.role,
      active: u.active,
      productAccess: resolveEffectiveAccessForUser({
        meta,
        subscription,
        userId: u.id,
      }),
      accessOverride: (userAccessMap[u.id] as Record<string, unknown> | undefined) ?? null,
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/v1/tenants/users/:userId ────────────────────────────────────

router.patch("/users/:userId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!requireTenantManager(req, res)) return;

    const userId = String(req.params.userId ?? "").trim();
    if (!userId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "userId is required" });
      return;
    }

    const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!target || target.tenantId !== req.tenantId) {
      res.status(404).json({ error: "NOT_FOUND", message: "User not found in this tenant" });
      return;
    }

    const { role, active, access } = req.body as {
      role?: string;
      active?: boolean;
      access?: { lead?: boolean; assist?: boolean };
    };

    if (role !== undefined) {
      const allowedRoles = new Set(["owner", "admin", "operator", "sales_rep", "analyst", "client_viewer"]);
      if (!allowedRoles.has(role)) {
        res.status(400).json({ error: "INVALID_INPUT", message: "Unsupported role" });
        return;
      }
      await db.update(users).set({ role }).where(eq(users.id, userId));
    }

    if (active !== undefined) {
      await db.update(users).set({ active: Boolean(active) }).where(eq(users.id, userId));
    }

    if (access !== undefined) {
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, req.tenantId) });
      if (!tenant) {
        res.status(404).json({ error: "Tenant not found" });
        return;
      }

      const meta = (tenant.metadata as Record<string, unknown>) ?? {};
      const userAccessMap = (meta.user_product_access as Record<string, unknown> | undefined) ?? {};
      const nextMap = {
        ...userAccessMap,
        [userId]: {
          ...(typeof access.lead === "boolean" && { lead: access.lead }),
          ...(typeof access.assist === "boolean" && { assist: access.assist }),
        },
      };

      await db
        .update(tenants)
        .set({
          metadata: {
            ...meta,
            user_product_access: nextMap,
          },
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, req.tenantId));
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
