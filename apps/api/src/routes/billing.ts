import { Router, type Request, type Response, type NextFunction, type Router as ExpressRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, tenantSubscriptions, tenants, users } from "@qyro/db";
import { redis } from "@qyro/queue";
import { resolveTenantBaseAccess } from "../lib/entitlements";

// Stripe's module shape varies by TS moduleInterop settings; runtime require is safest here.
const Stripe = require("stripe") as any;

type ProductAccess = {
  lead: boolean;
  assist: boolean;
};

type BillingProduct = "lead" | "assist" | "bundle";
type BillingPlan = "starter" | "growth" | "pro";

const ACTIVE_LIKE_STATUSES = new Set(["trialing", "active", "past_due"]);

const router: ExpressRouter = Router();
const publicRouter: ExpressRouter = Router();

type StripeClient = any;

let stripeClient: StripeClient | null = null;

function getStripeClient(): StripeClient {
  if (stripeClient) return stripeClient;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  stripeClient = new Stripe(secretKey, {
    apiVersion: "2024-06-20",
  });

  return stripeClient;
}

function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }
  return secret;
}

function priceSet(...values: Array<string | undefined>): Set<string> {
  return new Set(values.map((v) => (v ?? "").trim()).filter(Boolean));
}

const LEAD_PRICE_IDS = priceSet(
  process.env.STRIPE_PRICE_LEAD_STARTER,
  process.env.STRIPE_PRICE_LEAD_GROWTH,
);

const ASSIST_PRICE_IDS = priceSet(
  process.env.STRIPE_PRICE_ASSIST_STARTER,
  process.env.STRIPE_PRICE_ASSIST_GROWTH,
);

const BUNDLE_PRICE_IDS = priceSet(
  process.env.STRIPE_PRICE_BUNDLE_STARTER,
  process.env.STRIPE_PRICE_BUNDLE_GROWTH,
);

function isAllowedCheckoutPriceId(priceId: string): boolean {
  return LEAD_PRICE_IDS.has(priceId) || ASSIST_PRICE_IDS.has(priceId) || BUNDLE_PRICE_IDS.has(priceId);
}

function getPriceId(product: BillingProduct, plan: BillingPlan): string | null {
  const key = `${product}_${plan}`.toUpperCase();
  const envKey = `STRIPE_PRICE_${key}`;
  const value = process.env[envKey];
  return value && value.trim().length > 0 ? value.trim() : null;
}

function resolveAccessFromPriceId(priceId: string): ProductAccess {
  if (BUNDLE_PRICE_IDS.has(priceId)) {
    return { lead: true, assist: true };
  }
  if (LEAD_PRICE_IDS.has(priceId)) {
    return { lead: true, assist: false };
  }
  if (ASSIST_PRICE_IDS.has(priceId)) {
    return { lead: false, assist: true };
  }
  return { lead: false, assist: false };
}

function applySubscriptionStatus(access: ProductAccess, status: string): ProductAccess {
  if (!ACTIVE_LIKE_STATUSES.has(status)) {
    return { lead: false, assist: false };
  }
  return access;
}

function mergeAccess(a: ProductAccess, b: ProductAccess): ProductAccess {
  return {
    lead: a.lead || b.lead,
    assist: a.assist || b.assist,
  };
}

function accessIncludes(current: ProductAccess, requested: ProductAccess): boolean {
  const leadCovered = requested.lead ? current.lead : true;
  const assistCovered = requested.assist ? current.assist : true;
  return leadCovered && assistCovered;
}

function toDate(value?: number | null): Date | null {
  if (!value) return null;
  return new Date(value * 1000);
}

async function writeTenantProductAccess(tenantId: string, access: ProductAccess): Promise<void> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });

  if (!tenant) return;

  const meta = (tenant.metadata as Record<string, unknown> | null) ?? {};
  const nextMeta: Record<string, unknown> = {
    ...meta,
    product_access: access,
  };

  await db
    .update(tenants)
    .set({
      metadata: nextMeta,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));
}

async function listCustomerSubscriptionsForTenant(params: {
  stripe: StripeClient;
  customerId: string;
  tenantId: string;
}): Promise<any[]> {
  const { stripe, customerId, tenantId } = params;

  const subscriptions: any[] = [];
  let startingAfter: string | undefined;

  while (true) {
    const page = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    const rows = Array.isArray(page?.data) ? page.data : [];
    subscriptions.push(
      ...rows.filter((sub: any) => String(sub?.metadata?.tenantId ?? "").trim() === tenantId),
    );

    if (!page?.has_more || rows.length === 0) break;
    startingAfter = String(rows[rows.length - 1]?.id ?? "").trim() || undefined;
    if (!startingAfter) break;
  }

  return subscriptions;
}

function pickRepresentativeSubscription(subscriptions: any[]): any | null {
  if (subscriptions.length === 0) return null;

  const activeLike = subscriptions.find((sub) =>
    ACTIVE_LIKE_STATUSES.has(String(sub?.status ?? "").trim()),
  );
  if (activeLike) return activeLike;

  return subscriptions[0] ?? null;
}

function resolveMergedAccessFromSubscriptions(subscriptions: any[]): ProductAccess {
  let access: ProductAccess = { lead: false, assist: false };

  for (const sub of subscriptions) {
    const priceId = String(sub?.items?.data?.[0]?.price?.id ?? "").trim();
    if (!priceId) continue;
    const raw = resolveAccessFromPriceId(priceId);
    const activeScoped = applySubscriptionStatus(raw, String(sub?.status ?? ""));
    access = mergeAccess(access, activeScoped);
  }

  return access;
}

async function syncTenantAccessFromStripe(params: {
  stripe: StripeClient;
  tenantId: string;
  customerId: string;
}): Promise<void> {
  const { stripe, tenantId, customerId } = params;
  const subscriptions = await listCustomerSubscriptionsForTenant({ stripe, customerId, tenantId });
  const mergedAccess = resolveMergedAccessFromSubscriptions(subscriptions);
  const representative = pickRepresentativeSubscription(subscriptions);

  if (!representative) {
    await db
      .insert(tenantSubscriptions)
      .values({
        tenantId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: "",
        stripePriceId: "",
        status: "none",
        productAccess: mergedAccess,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: tenantSubscriptions.tenantId,
        set: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: "",
          stripePriceId: "",
          status: "none",
          productAccess: mergedAccess,
          currentPeriodStart: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          updatedAt: new Date(),
        },
      });

    await writeTenantProductAccess(tenantId, mergedAccess);
    return;
  }

  const priceId = String(representative?.items?.data?.[0]?.price?.id ?? "").trim();
  await db
    .insert(tenantSubscriptions)
    .values({
      tenantId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: String(representative.id),
      stripePriceId: priceId,
      status: String(representative.status ?? "none"),
      productAccess: mergedAccess,
      currentPeriodStart: toDate(representative.current_period_start),
      currentPeriodEnd: toDate(representative.current_period_end),
      cancelAtPeriodEnd: Boolean(representative.cancel_at_period_end),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: tenantSubscriptions.tenantId,
      set: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: String(representative.id),
        stripePriceId: priceId,
        status: String(representative.status ?? "none"),
        productAccess: mergedAccess,
        currentPeriodStart: toDate(representative.current_period_start),
        currentPeriodEnd: toDate(representative.current_period_end),
        cancelAtPeriodEnd: Boolean(representative.cancel_at_period_end),
        updatedAt: new Date(),
      },
    });

  await writeTenantProductAccess(tenantId, mergedAccess);
}

async function upsertSubscriptionFromStripe(params: {
  stripe: StripeClient;
  tenantId: string;
  customerId: string;
  subscription: any;
}): Promise<void> {
  const { stripe, tenantId, customerId, subscription } = params;

  const priceId = subscription.items.data[0]?.price?.id;
  if (!priceId) {
    throw new Error("Stripe subscription does not include a price id");
  }

  await syncTenantAccessFromStripe({ stripe, tenantId, customerId });
}

// ─── Authenticated billing routes ────────────────────────────────────────────

router.get("/v1/billing/subscription", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await db.query.tenantSubscriptions.findFirst({
      where: eq(tenantSubscriptions.tenantId, req.tenantId),
    });

    if (!row) {
      res.json({
        data: {
          hasSubscription: false,
          status: "none",
          productAccess: { lead: false, assist: false },
        },
      });
      return;
    }

    res.json({
      data: {
        hasSubscription: true,
        status: row.status,
        stripePriceId: row.stripePriceId,
        productAccess: row.productAccess,
        currentPeriodStart: row.currentPeriodStart,
        currentPeriodEnd: row.currentPeriodEnd,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/v1/billing/checkout-session", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stripe = getStripeClient();
    const tenantId = req.tenantId;

    const { product, plan, priceId: rawPriceId, successUrl, cancelUrl } = req.body as {
      product?: BillingProduct;
      plan?: BillingPlan;
      priceId?: string;
      successUrl?: string;
      cancelUrl?: string;
    };

    if (product === "bundle" && !rawPriceId) {
      res.status(400).json({
        error: "PRODUCT_RETIRED",
        message: "Bundle checkout has been retired. Add Lead and Assist subscriptions individually.",
      });
      return;
    }

    const resolvedPriceId = (rawPriceId && isAllowedCheckoutPriceId(rawPriceId))
      ? rawPriceId
      : (product && plan ? getPriceId(product, plan) : null);

    if (!resolvedPriceId || !isAllowedCheckoutPriceId(resolvedPriceId)) {
      res.status(400).json({
        error: "INVALID_PRICE",
        message: "Invalid or unsupported Stripe price configuration",
      });
      return;
    }

    const tenant = await db.query.tenants.findFirst({
      where: and(eq(tenants.id, tenantId), eq(tenants.active, true)),
    });

    if (!tenant) {
      res.status(404).json({ error: "NOT_FOUND", message: "Tenant not found" });
      return;
    }

    const existing = await db.query.tenantSubscriptions.findFirst({
      where: eq(tenantSubscriptions.tenantId, tenantId),
    });
    const currentAccess = resolveTenantBaseAccess(tenant.metadata, existing);
    const requestedAccess = resolveAccessFromPriceId(resolvedPriceId);
    if (accessIncludes(currentAccess, requestedAccess)) {
      const tenantType = String((tenant.metadata as Record<string, unknown> | null)?.tenant_type ?? "").trim();
      const destination = requestedAccess.assist && !requestedAccess.lead
        ? "/client/dashboard"
        : requestedAccess.lead && !requestedAccess.assist
          ? "/internal/dashboard"
          : tenantType === "assistant"
            ? "/client/dashboard"
            : "/internal/dashboard";

      res.status(409).json({
        error: "ALREADY_SUBSCRIBED",
        message: "This workspace is already active for your account",
        data: {
          destination,
        },
      });
      return;
    }

    // Fetch user email to pre-fill on checkout
    const tenantUser = await db.query.users.findFirst({
      where: eq(users.id, req.userId),
    });
    const userEmail = tenantUser?.email?.includes("@clerk.local") ? undefined : (tenantUser?.email ?? undefined);

    const existingCustomerId = existing?.stripeCustomerId;
    let customerId = existingCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        name: tenant.name,
        ...(userEmail && { email: userEmail }),
        metadata: { tenantId },
      });
      customerId = customer.id;
    }

    const baseAppUrl = process.env.APP_BASE_URL ?? "https://qyro.us";

    // Validate caller-supplied redirect URLs against the allowed app origin.
    // Prevents open-redirect phishing after Stripe checkout completion.
    const allowedRedirectOrigins = new Set(
      [baseAppUrl, "https://qyro.us", "https://www.qyro.us"]
        .map((u) => { try { return new URL(u).origin; } catch { return ""; } })
        .filter(Boolean),
    );

    function isAllowedRedirectUrl(url: string | undefined): boolean {
      if (!url) return true;
      try {
        return allowedRedirectOrigins.has(new URL(url).origin);
      } catch {
        return false;
      }
    }

    if (!isAllowedRedirectUrl(successUrl) || !isAllowedRedirectUrl(cancelUrl)) {
      res.status(400).json({
        error: "INVALID_REDIRECT",
        message: "successUrl and cancelUrl must point to an allowed domain",
      });
      return;
    }

    const productDescriptions: Record<string, string> = {
      lead: "Automated outbound calling pipeline with AI voice agents. Upload prospects, set campaigns, and let QYRO Lead handle the outreach 24/7.",
      assist: "AI-powered inbound assistant that handles calls on your existing business number — answers questions, books appointments, and hands off to your team automatically. No number porting required.",
      bundle: "Legacy bundle (retired). Use individual Lead and Assist subscriptions for new purchases.",
    };

    const productLabels: Record<string, string> = {
      lead: "QYRO Lead",
      assist: "QYRO Assist",
      bundle: "QYRO Bundle (Legacy)",
    };

    const sessionLabel = product ? (productLabels[product] ?? "QYRO") : "QYRO";
    const sessionDescription = product ? (productDescriptions[product] ?? "") : "";

    const successPath = product
      ? `${baseAppUrl}/products?billing=success&upgrade=${encodeURIComponent(product)}`
      : `${baseAppUrl}/products?billing=success`;
    const cancelPath = product
      ? `${baseAppUrl}/products?billing=canceled&upgrade=${encodeURIComponent(product)}`
      : `${baseAppUrl}/products?billing=canceled`;

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      ...(userEmail && { customer_email: undefined }), // customer already set; email pre-filled via customer object
      billing_address_collection: "auto",
      allow_promotion_codes: true,
      line_items: [
        {
          price: resolvedPriceId,
          quantity: 1,
        },
      ],
      success_url: successUrl ?? successPath,
      cancel_url: cancelUrl ?? cancelPath,
      custom_text: {
        submit: {
          message: `You're subscribing to ${sessionLabel}. Cancel anytime from your account settings.`,
        },
        ...(sessionDescription && {
          after_submit: {
            message: sessionDescription,
          },
        }),
      },
      metadata: { tenantId },
      subscription_data: {
        metadata: { tenantId },
        description: sessionLabel,
      },
    });

    res.json({
      data: {
        sessionId: checkout.id,
        url: checkout.url,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/v1/billing/portal-session", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stripe = getStripeClient();

    const row = await db.query.tenantSubscriptions.findFirst({
      where: eq(tenantSubscriptions.tenantId, req.tenantId),
    });

    if (!row) {
      res.status(404).json({
        error: "NOT_FOUND",
        message: "No active subscription for this tenant",
      });
      return;
    }

    const baseAppUrl = process.env.APP_BASE_URL ?? "https://qyro.us";
    const portal = await stripe.billingPortal.sessions.create({
      customer: row.stripeCustomerId,
      return_url: `${baseAppUrl}/products`,
    });

    res.json({ data: { url: portal.url } });
  } catch (err) {
    next(err);
  }
});

// ─── Public Stripe webhook route ─────────────────────────────────────────────

publicRouter.post("/stripe", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stripe = getStripeClient();
    const webhookSecret = getWebhookSecret();

    const signature = req.headers["stripe-signature"];
    if (!signature || typeof signature !== "string") {
      res.status(400).json({ error: "BAD_REQUEST", message: "Missing stripe-signature header" });
      return;
    }

    const rawBody =
      ((req as unknown as Record<string, unknown>).rawBody as Buffer | undefined)
      ?? (Buffer.isBuffer(req.body) ? req.body : undefined);
    if (!rawBody) {
      res.status(400).json({ error: "BAD_REQUEST", message: "Missing raw request body" });
      return;
    }

    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    const replayKey = `stripe:webhook:event:${event.id}`;
    const replayResult = await redis.set(replayKey, "1", "EX", 7 * 24 * 60 * 60, "NX");
    if (replayResult !== "OK") {
      res.json({ received: true, duplicate: true });
      return;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as any;
      if (session.mode === "subscription" && session.subscription && session.customer) {
        const tenantId = String(session.metadata?.tenantId ?? "").trim();
        if (tenantId) {
          const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
          await upsertSubscriptionFromStripe({
            stripe,
            tenantId,
            customerId: String(session.customer),
            subscription,
          });
        }
      }
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
      const subscription = event.data.object as any;
      const tenantId = String(subscription.metadata?.tenantId ?? "").trim();
      const customerId = String(subscription.customer);

      if (tenantId) {
        await upsertSubscriptionFromStripe({ stripe, tenantId, customerId, subscription });
      }
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as any;
      const subscriptionId = String(invoice.subscription ?? "").trim();

      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const tenantId = String(subscription?.metadata?.tenantId ?? "").trim();
        const customerId = String(subscription?.customer ?? "").trim();
        if (tenantId && customerId) {
          await syncTenantAccessFromStripe({ stripe, tenantId, customerId });
        }
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as any;
      const tenantId = String(subscription?.metadata?.tenantId ?? "").trim();
      const customerId = String(subscription?.customer ?? "").trim();
      if (tenantId && customerId) {
        await syncTenantAccessFromStripe({ stripe, tenantId, customerId });

        const current = await db.query.tenantSubscriptions.findFirst({
          where: eq(tenantSubscriptions.tenantId, tenantId),
        });
        const access = (current?.productAccess as ProductAccess | undefined) ?? { lead: false, assist: false };

        if (!access.lead && !access.assist) {
          // Freeze tenant data only when no paid products remain.
          await db
            .update(tenants)
            .set({ dataFrozenAt: new Date(), updatedAt: new Date() })
            .where(eq(tenants.id, tenantId));

          console.log(`[billing] data frozen for tenant ${tenantId} on final subscription cancellation`);
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
});

export { publicRouter as billingPublicRouter };
export default router;
