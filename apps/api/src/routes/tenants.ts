// QYRO Tenants routes — Session O
// Auth + tenant scoping applied upstream.
//
// Routes:
//   GET   /api/v1/tenants/settings  — return name + metadata fields for this tenant
//   PATCH /api/v1/tenants/settings  — update name + metadata fields

import { Router, type Request, type Response, type NextFunction, type Router as ExpressRouter } from "express";
import { eq } from "drizzle-orm";
import { db, decryptSecret, encryptSecret, tenantIntegrationSecrets, tenantSubscriptions, tenants, users } from "@qyro/db";
import { normalizeBookingMode, normalizeCalendarProvider } from "@qyro/agents/assistBooking";
import { isMasterAdminUser, isTenantManagerRole, resolveEffectiveAccessForUser, resolveTenantBaseAccess, resolveTrialState } from "../lib/entitlements";
import { getWidgetTokenVersion, issueWidgetToken } from "../lib/widgetAuth";

const router: ExpressRouter = Router();

function normalizePhone(value?: string): string {
  return (value ?? "").replace(/[^+\d]/g, "").trim();
}

function maskApiKey(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(value.length - 8)}${value.slice(-4)}`;
}

function readSecretValue(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const text = String(candidate ?? "").trim();
    if (!text) continue;
    return decryptSecret(text) ?? "";
  }
  return "";
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
    const integrationSecrets = await db.query.tenantIntegrationSecrets.findFirst({
      where: eq(tenantIntegrationSecrets.tenantId, req.tenantId),
    });
    const calendarApiKey = readSecretValue(
      integrationSecrets?.calendarApiKey,
      meta.calendarApiKey as string,
      meta.calendar_api_key as string,
    );
    const apolloApiKey = readSecretValue(
      integrationSecrets?.apolloApiKey,
      meta.apolloApiKey as string,
    );
    const hunterApiKey = readSecretValue(
      integrationSecrets?.hunterApiKey,
      meta.hunterApiKey as string,
    );
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
    const calendarProvider = normalizeCalendarProvider(meta.calendarProvider ?? meta.calendar_provider);
    const bookingMode = normalizeBookingMode(meta.bookingMode ?? meta.booking_mode, calendarProvider);
    let widgetToken: { token: string; expiresAt: string; version: number } | null = null;
    try {
      widgetToken = issueWidgetToken({
        tenantId: tenant.id,
        metadata: meta,
      });
    } catch {
      widgetToken = null;
    }

    res.json({
      id:               tenant.id,
      name:             tenant.name,
      approvedServices: (meta.approvedServices as string) ?? "",
      bookingLink:      (meta.bookingLink as string) ?? "",
      emailFromName:    (meta.emailFromName as string) ?? "",
      calendarProvider,
      bookingMode,
      hasCalendarApiKey:   !!calendarApiKey,
      calendarBookingUrl:  (meta.calendarBookingUrl as string) ?? "",
      calendarEventTypeId: (meta.calendarEventTypeId as string) ?? "",
      providersList:       (meta.providersList as string) ?? "",
      autoRespond:      Boolean(meta.autoRespond ?? false),
      businessHours:    (meta.businessHours as string) ?? "",
      voiceNumber,
      connectionMethod: (meta.connectionMethod as string) ?? "forwarding",
      widgetAllowedOrigins: Array.isArray(meta.widget_allowed_origins)
        ? meta.widget_allowed_origins
        : typeof meta.widgetAllowedOrigins === "string"
          ? meta.widgetAllowedOrigins
          : "",
      autoSendMissedCall: Boolean(tenant.autoSendMissedCall ?? false),
      escalationContactPhone: tenant.escalationContactPhone ?? (meta.escalationContactPhone as string | undefined) ?? "",
      escalationContactEmail: tenant.escalationContactEmail ?? (meta.escalationContactEmail as string | undefined) ?? "",
      voiceRuntime: "signalwire",
      industry: (meta.industry as string) ?? "",
      timezone: (meta.timezone as string) ?? "",
      businessDescription: (meta.businessDescription as string) ?? "",
      greetingScript: (meta.greetingScript as string) ?? "",
      escalationPhrases: (meta.escalationPhrases as string) ?? "",
      plan: (meta.plan as string) ?? subscription?.stripePriceId ?? "",
      subscriptionStatus: (subscription?.status as string) ?? "none",
      enrichmentProvider:    (meta.enrichmentProvider as string) ?? "mock",
      outreachEnabled:       meta.outreach_enabled !== false,
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
      onboardingComplete: meta.onboarding_complete === false ? false : true,
      tenantType: (meta.tenant_type as string) ?? "",
      widgetToken: widgetToken?.token ?? "",
      widgetTokenExpiresAt: widgetToken?.expiresAt ?? null,
      widgetTokenVersion: widgetToken?.version ?? getWidgetTokenVersion(meta),
      widgetSecurityConfigured: Boolean(widgetToken),
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
      bookingMode,
      calendarApiKey,
      calendarBookingUrl,
      calendarEventTypeId,
      providersList,
      autoRespond,
      autoSendMissedCall,
      escalationContactPhone,
      escalationContactEmail,
      businessHours,
      voiceNumber,
      connectionMethod,
      widgetAllowedOrigins,
      enrichmentProvider,
      outreachEnabled,
      apolloApiKey,
      hunterApiKey,
      enrichmentMonthlyLimit,
      industry,
      timezone,
      businessDescription,
      greetingScript,
      escalationPhrases,
    } = req.body as {
      name?:             string;
      approvedServices?: string;
      bookingLink?:      string;
      emailFromName?:    string;
      calendarProvider?: "cal_com" | "google_calendar" | "calendly" | "square_appointments" | "acuity" | "callback_only";
      bookingMode?: "direct_booking" | "booking_link_sms" | "callback_only";
      calendarApiKey?: string;
      calendarBookingUrl?: string;
      calendarEventTypeId?: string;
      providersList?: string;
      autoRespond?: boolean;
      autoSendMissedCall?: boolean;
      escalationContactPhone?: string;
      escalationContactEmail?: string;
      businessHours?: string;
      voiceNumber?: string;
      connectionMethod?: "forwarding" | "webhook";
      widgetAllowedOrigins?: string | string[];
      enrichmentProvider?: "mock" | "apollo" | "hunter";
      outreachEnabled?: boolean;
      apolloApiKey?: string;
      hunterApiKey?: string;
      enrichmentMonthlyLimit?: number;
      industry?: string;
      timezone?: string;
      businessDescription?: string;
      greetingScript?: string;
      escalationPhrases?: string;
    };

    const existing = await db.query.tenants.findFirst({
      where: eq(tenants.id, req.tenantId),
    });

    if (!existing) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const existingMeta = (existing.metadata as Record<string, unknown>) ?? {};
    const normalizedCalendarProvider = calendarProvider !== undefined
      ? normalizeCalendarProvider(calendarProvider)
      : normalizeCalendarProvider(existingMeta.calendarProvider ?? existingMeta.calendar_provider);
    const normalizedBookingMode = bookingMode !== undefined
      ? normalizeBookingMode(bookingMode, normalizedCalendarProvider)
      : normalizeBookingMode(existingMeta.bookingMode ?? existingMeta.booking_mode, normalizedCalendarProvider);

    const updatedMeta: Record<string, unknown> = {
      ...existingMeta,
      ...(approvedServices !== undefined && { approvedServices }),
      ...(bookingLink      !== undefined && { bookingLink }),
      ...(emailFromName    !== undefined && { emailFromName }),
      ...(calendarProvider    !== undefined && {
        calendarProvider: normalizedCalendarProvider,
        calendar_provider: normalizedCalendarProvider,
      }),
      ...(bookingMode        !== undefined && {
        bookingMode: normalizedBookingMode,
        booking_mode: normalizedBookingMode,
      }),
      ...(calendarBookingUrl  !== undefined && { calendarBookingUrl }),
      ...(calendarEventTypeId !== undefined && { calendarEventTypeId }),
      ...(providersList       !== undefined && { providersList }),
      ...(autoRespond      !== undefined && { autoRespond: Boolean(autoRespond) }),
      ...(businessHours    !== undefined && { businessHours }),
      ...(voiceNumber !== undefined && {
        voiceNumber,
        voice_number: voiceNumber,
      }),
      ...(connectionMethod !== undefined && {
        connectionMethod: connectionMethod === "webhook" ? "webhook" : "forwarding",
      }),
      ...(widgetAllowedOrigins !== undefined && {
        widget_allowed_origins: Array.isArray(widgetAllowedOrigins)
          ? widgetAllowedOrigins.map((value) => String(value).trim()).filter(Boolean)
          : String(widgetAllowedOrigins)
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
      }),
      voice_runtime: "signalwire",
      ...(enrichmentProvider !== undefined && { enrichmentProvider }),
      ...(outreachEnabled !== undefined && { outreach_enabled: Boolean(outreachEnabled) }),
      ...(enrichmentMonthlyLimit !== undefined && {
        enrichmentMonthlyLimit: Math.max(0, Number(enrichmentMonthlyLimit) || 0),
      }),
      ...(industry           !== undefined && { industry }),
      ...(timezone           !== undefined && { timezone }),
      ...(businessDescription !== undefined && { businessDescription }),
      ...(greetingScript     !== undefined && { greetingScript }),
      ...(escalationPhrases  !== undefined && { escalationPhrases }),
    };

    delete updatedMeta.retell_agent_id;
    delete updatedMeta.retellAgentId;
    delete updatedMeta.calendarApiKey;
    delete updatedMeta.calendar_api_key;
    delete updatedMeta.apolloApiKey;
    delete updatedMeta.hunterApiKey;

    const secretPatch: Record<string, string> = {};
    if (calendarApiKey !== undefined && calendarApiKey.trim().length > 0) {
      secretPatch.calendarApiKey = encryptSecret(calendarApiKey.trim());
    }
    if (apolloApiKey !== undefined && apolloApiKey.trim().length > 0) {
      secretPatch.apolloApiKey = encryptSecret(apolloApiKey.trim());
    }
    if (hunterApiKey !== undefined && hunterApiKey.trim().length > 0) {
      secretPatch.hunterApiKey = encryptSecret(hunterApiKey.trim());
    }

    await db
      .update(tenants)
      .set({
        ...(name !== undefined && { name: name.trim() }),
        ...(voiceNumber !== undefined && {
          voiceNumber: normalizePhone(voiceNumber) || null,
        }),
        ...(autoSendMissedCall !== undefined && {
          autoSendMissedCall: Boolean(autoSendMissedCall),
        }),
        ...(escalationContactPhone !== undefined && {
          escalationContactPhone: escalationContactPhone.trim() || null,
        }),
        ...(escalationContactEmail !== undefined && {
          escalationContactEmail: escalationContactEmail.trim() || null,
        }),
        metadata:  updatedMeta,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, req.tenantId));

    if (Object.keys(secretPatch).length > 0) {
      await db
        .insert(tenantIntegrationSecrets)
        .values({
          tenantId: req.tenantId,
          ...secretPatch,
        })
        .onConflictDoUpdate({
          target: tenantIntegrationSecrets.tenantId,
          set: {
            ...secretPatch,
            updatedAt: new Date(),
          },
        });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/v1/tenants/onboarding ────────────────────────────────────────
// Saves onboarding data and marks the tenant as onboarding-complete.
// Called once at the end of the onboarding flow.

router.patch("/onboarding", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      productType,
      name,
      industry,
      phone,
      timezone,
      businessDescription,
      services,
      greeting,
    } = req.body as {
      productType?: "assistant" | "lead_engine";
      name?: string;
      industry?: string;
      phone?: string;
      timezone?: string;
      businessDescription?: string;
      services?: string;
      greeting?: string;
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
      onboarding_complete: true,
      ...(productType !== undefined && { tenant_type: productType }),
      ...(industry    !== undefined && { industry }),
      ...(timezone    !== undefined && { timezone }),
      ...(businessDescription !== undefined && { businessDescription }),
      ...(services    !== undefined && { approvedServices: services }),
      ...(greeting    !== undefined && { greetingScript: greeting }),
    };

    await db
      .update(tenants)
      .set({
        ...(name?.trim() && { name: name.trim() }),
        ...(phone !== undefined && {
          voiceNumber: normalizePhone(phone) || null,
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

// ─── PATCH /api/v1/tenants/settings/missed-call-auto-send ────────────────────

router.patch("/settings/missed-call-auto-send", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "INVALID_INPUT", message: "enabled (boolean) is required" });
      return;
    }

    await db
      .update(tenants)
      .set({ autoSendMissedCall: enabled, updatedAt: new Date() })
      .where(eq(tenants.id, req.tenantId));

    res.json({ ok: true, autoSendMissedCall: enabled });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/tenants/settings/widget-token/rotate ───────────────────────

router.post("/settings/widget-token/rotate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!requireTenantManager(req, res)) return;

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, req.tenantId),
    });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const meta = (tenant.metadata as Record<string, unknown>) ?? {};
    const nextMeta = {
      ...meta,
      widget_token_version: getWidgetTokenVersion(meta) + 1,
    };

    await db
      .update(tenants)
      .set({
        metadata: nextMeta,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, req.tenantId));

    const widgetToken = issueWidgetToken({
      tenantId: tenant.id,
      metadata: nextMeta,
    });

    res.json({
      ok: true,
      widgetToken: widgetToken.token,
      widgetTokenExpiresAt: widgetToken.expiresAt,
      widgetTokenVersion: widgetToken.version,
    });
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

// ─── GET /api/v1/tenants/faq  (stub) ─────────────────────────────────────────

router.get("/faq", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, req.tenantId) });
    if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
    const meta = (tenant.metadata as Record<string, unknown>) ?? {};
    const faq = Array.isArray(meta.faqEntries) ? meta.faqEntries : [];
    res.json({ faq });
  } catch (err) { next(err); }
});

// ─── PATCH /api/v1/tenants/faq  (stub) ───────────────────────────────────────

router.patch("/faq", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { faq } = req.body as { faq?: unknown[] };
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, req.tenantId) });
    if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
    const meta = (tenant.metadata as Record<string, unknown>) ?? {};
    await db.update(tenants).set({
      metadata: { ...meta, faqEntries: Array.isArray(faq) ? faq : [] },
      updatedAt: new Date(),
    }).where(eq(tenants.id, req.tenantId));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/tenants/users/invite  (stub) ───────────────────────────────

router.post("/users/invite", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!requireTenantManager(req, res)) return;
    const { email, role } = req.body as { email?: string; role?: string };
    if (!email?.trim()) {
      res.status(400).json({ error: "INVALID_INPUT", message: "email is required" });
      return;
    }
    // Stub: invitation delivery not yet implemented.
    // When Clerk webhooks are wired, create the user record and send an invite email here.
    res.json({ ok: true, message: "Invitation queued — user will receive an email when invite delivery is configured." });
  } catch (err) { next(err); }
});

export default router;
