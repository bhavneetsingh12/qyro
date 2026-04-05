import type { Request } from "express";

type SubscriptionLike = {
  status?: string | null;
  productAccess?: unknown;
};

export type ProductAccess = {
  lead: boolean;
  assist: boolean;
};

export type TrialState = {
  active: boolean;
  expiresAt: string | null;
  callsRemaining: number;
};

const ACTIVE_SUB_STATUSES = new Set(["trialing", "active", "past_due"]);

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toAccess(value: unknown): ProductAccess {
  const obj = toObject(value);
  return {
    lead: obj.lead === true,
    assist: obj.assist === true,
  };
}

function orAccess(a: ProductAccess, b: ProductAccess): ProductAccess {
  return { lead: a.lead || b.lead, assist: a.assist || b.assist };
}

function resolveLegacyMetaAccess(meta: Record<string, unknown>): ProductAccess {
  const direct = toAccess(meta.product_access);
  if (direct.lead || direct.assist) return direct;

  const products = Array.isArray(meta.products)
    ? meta.products.map((v) => String(v).toLowerCase())
    : [];

  if (products.length > 0) {
    return {
      lead: products.includes("lead") || products.includes("qyro_lead"),
      assist: products.includes("assist") || products.includes("qyro_assist"),
    };
  }

  const single = String(meta.product ?? "").toLowerCase();
  if (single === "lead" || single === "qyro_lead") return { lead: true, assist: false };
  if (single === "assist" || single === "qyro_assist") return { lead: false, assist: true };
  return { lead: false, assist: false };
}

export function resolveTrialState(metaRaw: unknown): TrialState {
  const meta = toObject(metaRaw);
  const expiresAt = String(meta.trial_expires_at ?? "").trim() || null;
  const callsRemaining = Math.max(0, Number(meta.trial_calls_remaining ?? 0) || 0);

  if (!expiresAt) {
    return { active: false, expiresAt: null, callsRemaining };
  }

  const expiresTs = Date.parse(expiresAt);
  const active = Number.isFinite(expiresTs) && expiresTs > Date.now() && callsRemaining > 0;

  return {
    active,
    expiresAt,
    callsRemaining,
  };
}

export function resolveTenantBaseAccess(metaRaw: unknown, subscription?: SubscriptionLike | null): ProductAccess {
  const meta = toObject(metaRaw);
  const legacyMetaAccess = resolveLegacyMetaAccess(meta);

  const paidAccess = subscription && subscription.status && ACTIVE_SUB_STATUSES.has(subscription.status)
    ? toAccess(subscription.productAccess)
    : { lead: false, assist: false };

  const billingOverrideAccess = toAccess(meta.billing_override_access);
  const trialState = resolveTrialState(meta);
  const trialAccess = trialState.active ? toAccess(meta.trial_product_access) : { lead: false, assist: false };

  return orAccess(orAccess(orAccess(legacyMetaAccess, paidAccess), billingOverrideAccess), trialAccess);
}

export function resolveEffectiveAccessForUser(params: {
  meta: unknown;
  subscription?: SubscriptionLike | null;
  userId: string;
}): ProductAccess {
  const { meta, subscription, userId } = params;
  const base = resolveTenantBaseAccess(meta, subscription);

  const metaObj = toObject(meta);
  const userOverrides = toObject(metaObj.user_product_access);
  const override = toObject(userOverrides[userId]);

  const leadAllowed = typeof override.lead === "boolean" ? override.lead : true;
  const assistAllowed = typeof override.assist === "boolean" ? override.assist : true;

  return {
    lead: base.lead && leadAllowed,
    assist: base.assist && assistAllowed,
  };
}

export function isTenantManagerRole(role: string): boolean {
  return role === "owner" || role === "admin";
}

export function getClerkUserId(req: Request): string {
  return String((req as unknown as { auth?: { userId?: string } }).auth?.userId ?? "").trim();
}

export function isMasterAdminUser(params: { role: string; clerkId: string; email?: string | null }): boolean {
  if (params.role === "master_admin") return true;

  const envClerkIds = String(process.env.MASTER_ADMIN_CLERK_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  if (params.clerkId && envClerkIds.includes(params.clerkId)) {
    return true;
  }

  const envEmails = String(process.env.MASTER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  return Boolean(params.email && envEmails.includes(params.email.toLowerCase()));
}
