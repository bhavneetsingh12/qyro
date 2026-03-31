// Tenant scoping middleware.
// Must run after requireClerkAuth. Resolves tenantId from the authenticated
// Clerk user, sets it on req, and activates Postgres RLS context.

import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { adminDb, setTenantContext, users, tenants } from "@qyro/db";

declare global {
  namespace Express {
    interface Request {
      tenantId: string;
      userId: string;
      userRole: string;
      tenantType: string;
    }
  }
}

export const tenantMiddleware: RequestHandler = async (req, res, next) => {
  try {
    // Clerk userId is attached by clerkMiddleware + requireAuth before this runs
    const clerkUserId: string = (req as any).auth?.userId;
    if (!clerkUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Use adminDb (bypasses RLS) to look up the user before RLS context is set
    const user = await adminDb.query.users.findFirst({
      where: eq(users.clerkId, clerkUserId),
    });

    if (!user || !user.active) {
      res.status(403).json({ error: "User not found or inactive" });
      return;
    }

    const tenant = await adminDb.query.tenants.findFirst({
      where: eq(tenants.id, user.tenantId),
    });

    if (!tenant || !tenant.active) {
      res.status(403).json({ error: "Tenant not found or inactive" });
      return;
    }

    // Set tenant context for RLS — all subsequent db queries in this request
    // will be scoped to this tenant_id via the Postgres session variable
    await setTenantContext(tenant.id);

    req.tenantId = tenant.id;
    req.userId = user.id;
    req.userRole = user.role;
    req.tenantType = (tenant.metadata as Record<string, unknown>)?.tenant_type as string ?? "unknown";

    next();
  } catch (err) {
    next(err);
  }
};
