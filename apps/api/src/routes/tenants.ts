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

function maskApiKey(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(value.length - 8)}${value.slice(-4)}`;
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

    res.json({
      id:               tenant.id,
      name:             tenant.name,
      approvedServices: (meta.approvedServices as string) ?? "",
      bookingLink:      (meta.bookingLink as string) ?? "",
      emailFromName:    (meta.emailFromName as string) ?? "",
      enrichmentProvider:    (meta.enrichmentProvider as string) ?? "mock",
      hasApolloApiKey:       !!apolloApiKey,
      hasHunterApiKey:       !!hunterApiKey,
      apolloApiKeyMasked:    apolloApiKey ? maskApiKey(apolloApiKey) : "",
      hunterApiKeyMasked:    hunterApiKey ? maskApiKey(hunterApiKey) : "",
      enrichmentMonthlyLimit: Number(meta.enrichmentMonthlyLimit ?? 2500),
      enrichmentMonthlyUsed:  Number(meta.enrichmentMonthlyUsed ?? 0),
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
      enrichmentProvider,
      apolloApiKey,
      hunterApiKey,
      enrichmentMonthlyLimit,
    } = req.body as {
      name?:             string;
      approvedServices?: string;
      bookingLink?:      string;
      emailFromName?:    string;
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
