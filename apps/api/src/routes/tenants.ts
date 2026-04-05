// QYRO Tenants routes — Session O
// Auth + tenant scoping applied upstream.
//
// Routes:
//   GET   /api/v1/tenants/settings  — return name + metadata fields for this tenant
//   PATCH /api/v1/tenants/settings  — update name + metadata fields

import { Router, type Request, type Response, type NextFunction, type Router as ExpressRouter } from "express";
import { eq } from "drizzle-orm";
import { db, tenants } from "@qyro/db";

const router: ExpressRouter = Router();

type ProductAccess = {
  lead: boolean;
  assist: boolean;
};

function maskApiKey(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(value.length - 8)}${value.slice(-4)}`;
}

function resolveProductAccess(meta: Record<string, unknown>): ProductAccess {
  const access = (meta.product_access as Record<string, unknown> | undefined) ?? {};

  if (typeof access.lead === "boolean" || typeof access.assist === "boolean") {
    return {
      lead: access.lead === true,
      assist: access.assist === true,
    };
  }

  const products = Array.isArray(meta.products)
    ? meta.products.map((v) => String(v).toLowerCase())
    : [];

  if (products.length > 0) {
    return {
      lead: products.includes("lead") || products.includes("qyro_lead"),
      assist: products.includes("assist") || products.includes("qyro_assist"),
    };
  }

  const singleProduct = String(meta.product ?? "").toLowerCase();
  if (singleProduct === "lead" || singleProduct === "qyro_lead") {
    return { lead: true, assist: false };
  }
  if (singleProduct === "assist" || singleProduct === "qyro_assist") {
    return { lead: false, assist: true };
  }

  // Default during transition: existing tenants can access both products.
  return { lead: true, assist: true };
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
    const productAccess = resolveProductAccess(meta);

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
      twilioNumber:     (meta.twilioNumber as string) ?? "",
      widgetAllowedOrigins: Array.isArray(meta.widget_allowed_origins)
        ? meta.widget_allowed_origins
        : typeof meta.widgetAllowedOrigins === "string"
          ? meta.widgetAllowedOrigins
          : "",
      voiceRuntime: (meta.voice_runtime as string) ?? "twilio",
      retellAgentId: (meta.retell_agent_id as string) ?? "",
      enrichmentProvider:    (meta.enrichmentProvider as string) ?? "mock",
      hasApolloApiKey:       !!apolloApiKey,
      hasHunterApiKey:       !!hunterApiKey,
      apolloApiKeyMasked:    apolloApiKey ? maskApiKey(apolloApiKey) : "",
      hunterApiKeyMasked:    hunterApiKey ? maskApiKey(hunterApiKey) : "",
      enrichmentMonthlyLimit: Number(meta.enrichmentMonthlyLimit ?? 2500),
      enrichmentMonthlyUsed:  Number(meta.enrichmentMonthlyUsed ?? 0),
      productAccess,
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
      twilioNumber,
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
      twilioNumber?: string;
      widgetAllowedOrigins?: string | string[];
      voiceRuntime?: "twilio" | "retell";
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
      ...(twilioNumber     !== undefined && { twilioNumber }),
      ...(widgetAllowedOrigins !== undefined && {
        widget_allowed_origins: Array.isArray(widgetAllowedOrigins)
          ? widgetAllowedOrigins.map((value) => String(value).trim()).filter(Boolean)
          : String(widgetAllowedOrigins)
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
      }),
      ...(voiceRuntime !== undefined && { voice_runtime: voiceRuntime === "retell" ? "retell" : "twilio" }),
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
        metadata:  updatedMeta,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, req.tenantId));

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
