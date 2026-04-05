import { Router, type Request, type Response, type NextFunction, type Router as ExpressRouter } from "express";
import { eq } from "drizzle-orm";
import { adminDb, tenants, users, tenantSubscriptions } from "@qyro/db";
import { getClerkUserId, isMasterAdminUser, resolveTenantBaseAccess, resolveTrialState } from "../lib/entitlements";

const router: ExpressRouter = Router();

async function requireMasterAdmin(req: Request, res: Response): Promise<{ id: string; clerkId: string; email: string | null; role: string } | null> {
  const clerkUserId = getClerkUserId(req);
  if (!clerkUserId) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Authentication required" });
    return null;
  }

  const user = await adminDb.query.users.findFirst({ where: eq(users.clerkId, clerkUserId) });
  if (!user) {
    res.status(403).json({ error: "FORBIDDEN", message: "User record not found" });
    return null;
  }

  const allowed = isMasterAdminUser({
    role: user.role,
    clerkId: user.clerkId,
    email: user.email,
  });

  if (!allowed) {
    res.status(403).json({ error: "FORBIDDEN", message: "Master admin role required" });
    return null;
  }

  return { id: user.id, clerkId: user.clerkId, email: user.email, role: user.role };
}

router.get("/v1/admin/me", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const current = await requireMasterAdmin(req, res);
    if (!current) return;

    res.json({
      data: {
        isMasterAdmin: true,
        id: current.id,
        email: current.email,
        role: current.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/v1/admin/tenants", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const current = await requireMasterAdmin(req, res);
    if (!current) return;

    const allTenants = await adminDb.query.tenants.findMany();

    const data = await Promise.all(allTenants.map(async (tenant) => {
      const meta = (tenant.metadata as Record<string, unknown> | null) ?? {};
      const subscription = await adminDb.query.tenantSubscriptions.findFirst({
        where: eq(tenantSubscriptions.tenantId, tenant.id),
      });

      return {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        active: tenant.active,
        plan: tenant.plan,
        subscriptionStatus: subscription?.status ?? "none",
        baseAccess: resolveTenantBaseAccess(meta, subscription),
        billingOverrideAccess: (meta.billing_override_access as Record<string, unknown>) ?? { lead: false, assist: false },
        trial: {
          ...resolveTrialState(meta),
          productAccess: (meta.trial_product_access as Record<string, unknown>) ?? { lead: false, assist: false },
        },
      };
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.patch("/v1/admin/tenants/:tenantId/access", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const current = await requireMasterAdmin(req, res);
    if (!current) return;

    const tenantId = String(req.params.tenantId ?? "").trim();
    if (!tenantId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "tenantId is required" });
      return;
    }

    const tenant = await adminDb.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    if (!tenant) {
      res.status(404).json({ error: "NOT_FOUND", message: "Tenant not found" });
      return;
    }

    const {
      billingOverrideAccess,
      trialDays,
      trialCalls,
      trialProductAccess,
      clearTrial,
    } = req.body as {
      billingOverrideAccess?: { lead?: boolean; assist?: boolean };
      trialDays?: number;
      trialCalls?: number;
      trialProductAccess?: { lead?: boolean; assist?: boolean };
      clearTrial?: boolean;
    };

    const meta = (tenant.metadata as Record<string, unknown>) ?? {};
    const nextMeta: Record<string, unknown> = { ...meta };

    if (billingOverrideAccess !== undefined) {
      nextMeta.billing_override_access = {
        lead: billingOverrideAccess.lead === true,
        assist: billingOverrideAccess.assist === true,
      };
    }

    if (clearTrial === true) {
      nextMeta.trial_expires_at = null;
      nextMeta.trial_calls_remaining = 0;
      nextMeta.trial_product_access = { lead: false, assist: false };
    } else if (trialDays !== undefined || trialCalls !== undefined || trialProductAccess !== undefined) {
      const days = Math.max(0, Number(trialDays ?? 0) || 0);
      const calls = Math.max(0, Number(trialCalls ?? 0) || 0);
      nextMeta.trial_expires_at = days > 0
        ? new Date(Date.now() + (days * 24 * 60 * 60 * 1000)).toISOString()
        : (meta.trial_expires_at ?? null);
      nextMeta.trial_calls_remaining = calls;
      nextMeta.trial_product_access = {
        lead: trialProductAccess?.lead === true,
        assist: trialProductAccess?.assist === true,
      };
    }

    await adminDb
      .update(tenants)
      .set({
        metadata: nextMeta,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.patch("/v1/admin/users/:userId/role", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const current = await requireMasterAdmin(req, res);
    if (!current) return;

    const userId = String(req.params.userId ?? "").trim();
    const role = String(req.body?.role ?? "").trim();

    if (!userId || !role) {
      res.status(400).json({ error: "INVALID_INPUT", message: "userId and role are required" });
      return;
    }

    const allowedRoles = new Set(["master_admin", "owner", "admin", "operator", "sales_rep", "analyst", "client_viewer"]);
    if (!allowedRoles.has(role)) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Unsupported role" });
      return;
    }

    await adminDb.update(users).set({ role }).where(eq(users.id, userId));

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
