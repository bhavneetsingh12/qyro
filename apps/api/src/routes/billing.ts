import { Router, type Request, type Response, type NextFunction, type Router as ExpressRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, tenantSubscriptions, tenants, users } from "@qyro/db";

// Stripe's module shape varies by TS moduleInterop settings; runtime require is safest here.
const Stripe = require("stripe") as any;

type ProductAccess = {
  lead: boolean;
  assist: boolean;
};

type BillingProduct = "lead" | "assist" | "bundle";
type BillingPlan = "starter" | "growth";

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

async function upsertSubscriptionFromStripe(params: {
  tenantId: string;
  customerId: string;
  subscription: any;
}): Promise<void> {
  const { tenantId, customerId, subscription } = params;

  const priceId = subscription.items.data[0]?.price?.id;
  if (!priceId) {
    throw new Error("Stripe subscription does not include a price id");
  }

  const rawAccess = resolveAccessFromPriceId(priceId);
  const productAccess = applySubscriptionStatus(rawAccess, subscription.status);

  await db
    .insert(tenantSubscriptions)
    .values({
      tenantId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      status: subscription.status,
      productAccess,
      currentPeriodStart: toDate(subscription.current_period_start),
      currentPeriodEnd: toDate(subscription.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: tenantSubscriptions.tenantId,
      set: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        status: subscription.status,
        productAccess,
        currentPeriodStart: toDate(subscription.current_period_start),
        currentPeriodEnd: toDate(subscription.current_period_end),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        updatedAt: new Date(),
      },
    });

  await writeTenantProductAccess(tenantId, productAccess);
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

    const productDescriptions: Record<string, string> = {
      lead: "Automated outbound calling pipeline with AI voice agents. Upload prospects, set campaigns, and let QYRO Lead handle the outreach 24/7.",
      assist: "AI-powered inbound assistant that answers calls, qualifies leads, books appointments, and hands off to your team — automatically.",
      bundle: "Full QYRO access: outbound lead generation + inbound AI assistant. Everything you need to run a hands-free voice pipeline.",
    };

    const productLabels: Record<string, string> = {
      lead: "QYRO Lead",
      assist: "QYRO Assist",
      bundle: "QYRO Lead + Assist Bundle",
    };

    const sessionLabel = product ? (productLabels[product] ?? "QYRO") : "QYRO";
    const sessionDescription = product ? (productDescriptions[product] ?? "") : "";

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
      success_url: successUrl ?? `${baseAppUrl}/products?billing=success`,
      cancel_url: cancelUrl ?? `${baseAppUrl}/products?billing=canceled`,
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

    const rawBody = (req as unknown as Record<string, unknown>).rawBody as Buffer | undefined;
    if (!rawBody) {
      res.status(400).json({ error: "BAD_REQUEST", message: "Missing raw request body" });
      return;
    }

    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as any;
      if (session.mode === "subscription" && session.subscription && session.customer) {
        const tenantId = String(session.metadata?.tenantId ?? "").trim();
        if (tenantId) {
          const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
          await upsertSubscriptionFromStripe({
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
        await upsertSubscriptionFromStripe({ tenantId, customerId, subscription });
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as any;
      const existing = await db.query.tenantSubscriptions.findFirst({
        where: eq(tenantSubscriptions.stripeSubscriptionId, subscription.id),
      });

      if (existing) {
        const productAccess = { lead: false, assist: false };
        await db
          .update(tenantSubscriptions)
          .set({
            status: "canceled",
            productAccess,
            currentPeriodStart: toDate(subscription.current_period_start),
            currentPeriodEnd: toDate(subscription.current_period_end),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            updatedAt: new Date(),
          })
          .where(eq(tenantSubscriptions.id, existing.id));

        await writeTenantProductAccess(existing.tenantId, productAccess);
      }
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
});

export { publicRouter as billingPublicRouter };
export default router;
