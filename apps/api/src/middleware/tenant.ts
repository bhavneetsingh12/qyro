// Tenant scoping middleware.
// Must run after requireClerkAuth. Resolves tenantId from the authenticated
// Clerk user, sets it on req, and activates Postgres RLS context.

import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { adminDb, setTenantContext, users, tenants } from "@qyro/db";

function toSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function provisionTenantForClerkUser(clerkUserId: string) {
  const suffix = clerkUserId.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toLowerCase() || "user";
  const tenantName = `Qyro Workspace ${suffix}`;
  const tenantSlug = `${toSlug(tenantName)}-${Date.now().toString().slice(-6)}`;

  const [tenant] = await adminDb
    .insert(tenants)
    .values({
      name: tenantName,
      slug: tenantSlug,
      plan: "starter",
      active: true,
      metadata: { provisioned_from: "clerk_first_login" },
    })
    .returning();

  const [user] = await adminDb
    .insert(users)
    .values({
      tenantId: tenant.id,
      clerkId: clerkUserId,
      email: `${clerkUserId}@clerk.local`,
      name: null,
      role: "owner",
      active: true,
    })
    .returning();

  return { tenant, user };
}

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
    if (process.env.NODE_ENV === "production" && process.env.DEV_BYPASS_AUTH === "true") {
      throw new Error("DEV_BYPASS_AUTH cannot be enabled in production");
    }

    if (process.env.DEV_BYPASS_AUTH === "true") {
      const tenantId = process.env.INTERNAL_TENANT_ID;
      if (!tenantId) {
        res.status(500).json({ error: "CONFIG_ERROR", message: "INTERNAL_TENANT_ID is required when DEV_BYPASS_AUTH=true" });
        return;
      }

      const tenant = await adminDb.query.tenants.findFirst({
        where: eq(tenants.id, tenantId),
      });

      if (!tenant || !tenant.active) {
        res.status(403).json({ error: "Tenant not found or inactive" });
        return;
      }

      const user = await adminDb.query.users.findFirst({
        where: eq(users.tenantId, tenantId),
      });

      await setTenantContext(tenant.id);

      req.tenantId = tenant.id;
      req.userId = user?.id ?? "00000000-0000-0000-0000-000000000000";
      req.userRole = user?.role ?? "owner";
      req.tenantType = (tenant.metadata as Record<string, unknown>)?.tenant_type as string ?? "unknown";

      next();
      return;
    }

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

    // First-login auto-provisioning for production signups.
    // If a Clerk-authenticated user does not exist yet, create a starter
    // tenant + owner user so authenticated routes can proceed.
    let resolvedUser = user;
    if (!resolvedUser) {
      const provisioned = await provisionTenantForClerkUser(clerkUserId);
      resolvedUser = provisioned.user;
    }

    if (!resolvedUser.active) {
      res.status(403).json({ error: "User not found or inactive" });
      return;
    }

    const tenant = await adminDb.query.tenants.findFirst({
      where: eq(tenants.id, resolvedUser.tenantId),
    });

    if (!tenant || !tenant.active) {
      res.status(403).json({ error: "Tenant not found or inactive" });
      return;
    }

    // Set tenant context for RLS — all subsequent db queries in this request
    // will be scoped to this tenant_id via the Postgres session variable
    await setTenantContext(tenant.id);

    req.tenantId = tenant.id;
    req.userId = resolvedUser.id;
    req.userRole = resolvedUser.role;
    req.tenantType = (tenant.metadata as Record<string, unknown>)?.tenant_type as string ?? "unknown";

    next();
  } catch (err) {
    next(err);
  }
};
