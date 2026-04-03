// QYRO Leads routes — Task F
// Auth + tenant scoping applied upstream (requireClerkAuth + tenantMiddleware in index.ts).
//
// Routes:
//   GET    /api/leads                       — list prospects (paginated)
//   GET    /api/leads/:id                   — get one prospect + enriched data
//   POST   /api/leads                       — manually add a prospect
//   POST   /api/leads/ingest                — discover + ingest leads via niche/location
//   POST   /api/leads/:id/research          — enqueue research job
//   POST   /api/leads/:id/outreach          — enqueue outreach job
//   GET    /api/leads/:id/messages          — list message drafts for a prospect
//   PATCH  /api/leads/messages/:messageId   — approve or revert a pending draft

import { Router, type Request, type Response, type NextFunction, type Router as ExpressRouter } from "express";
import { db } from "@qyro/db";
import { prospectsRaw, prospectsEnriched, messageAttempts } from "@qyro/db";
import { eq, and, desc } from "drizzle-orm";
import { researchQueue, outreachQueue } from "@qyro/queue";
import { quotaCheck } from "../middleware/quota";
import { runLeadDiscovery } from "@qyro/agents/leadDiscovery";

const router: ExpressRouter = Router();

// ─── GET /api/leads ────────────────────────────────────────────────────────────

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const limit  = Math.min(parseInt((req.query.limit  as string) || "50",  10), 200);
    const offset = parseInt((req.query.offset as string) || "0", 10);

    const rows = await db
      .select({
        id: prospectsRaw.id,
        businessName: prospectsRaw.businessName,
        niche: prospectsRaw.niche,
        domain: prospectsRaw.domain,
        phone: prospectsRaw.phone,
        email: prospectsRaw.email,  // Added email field
        source: prospectsRaw.source,
        consentState: prospectsRaw.consentState,
        deduped: prospectsRaw.deduped,
        createdAt: prospectsRaw.createdAt,
        // Check if enriched data exists
        researchedAt: prospectsEnriched.researchedAt,
        urgencyScore: prospectsEnriched.urgencyScore,
        fromCache: prospectsEnriched.fromCache,
      })
      .from(prospectsRaw)
      .leftJoin(prospectsEnriched, eq(prospectsRaw.id, prospectsEnriched.prospectId))
      .where(eq(prospectsRaw.tenantId, tenantId))
      .orderBy(desc(prospectsRaw.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ data: rows, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/leads/:id ────────────────────────────────────────────────────────

router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req;
    const { id } = req.params;

    const prospect = await db.query.prospectsRaw.findFirst({
      where: and(eq(prospectsRaw.tenantId, tenantId), eq(prospectsRaw.id, id)),
    });

    if (!prospect) {
      res.status(404).json({ error: "NOT_FOUND", message: "Prospect not found" });
      return;
    }

    const enriched = await db.query.prospectsEnriched.findFirst({
      where: and(
        eq(prospectsEnriched.tenantId, tenantId),
        eq(prospectsEnriched.prospectId, id),
      ),
    });

    res.json({ data: { ...prospect, enriched: enriched ?? null } });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/leads ───────────────────────────────────────────────────────────
// ─── POST /api/leads/ingest ────────────────────────────────────────────────────
// Run lead discovery for a given niche + location, ingest results, queue research.

router.post("/ingest", quotaCheck("lead_discovery"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req;
    const { niche, location, maxResults } = req.body as {
      niche:      string;
      location:   string | { locations: string[]; radius?: number };
      maxResults?: number;
    };

    if (!niche?.trim()) {
      res.status(400).json({ error: "INVALID_INPUT", message: "niche is required" });
      return;
    }
    if (!location) {
      res.status(400).json({ error: "INVALID_INPUT", message: "location is required" });
      return;
    }

    const max = Math.min(Math.max(1, parseInt(String(maxResults ?? 10), 10)), 50);
    const nicheStr = niche.trim();

    // Parse location: can be string or object with locations array and optional radius
    let locations: string[] = [];
    let radius: number | undefined;

    if (typeof location === "string") {
      locations = [location.trim()];
    } else if (typeof location === "object" && Array.isArray(location.locations)) {
      locations = location.locations
        .map((loc: string) => loc.trim())
        .filter((loc: string) => loc.length > 0);
      radius = location.radius;
    }

    // Normalize and dedupe locations
    locations = Array.from(new Set(locations.map((loc) => loc.replace(/\s+/g, " ").trim()))).filter(
      (loc) => loc.length > 0,
    );

    if (locations.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "location must be provided" });
      return;
    }

    console.debug("[leads/ingest] locations after normalize:", { locations, radius, maxResults });

    // Run lead discovery for each location and aggregate results
    let totalLeadsQueued = 0;
    let totalDuplicatesSkipped = 0;
    const sourceBreakdown = { google: 0, places: 0 };

    const perLocationMax = Math.max(1, Math.floor(max / locations.length));

    for (const loc of locations) {
      const locationStr = radius ? `${loc} (within ${radius} mile radius)` : loc;
      const result = await runLeadDiscovery({
        tenantId,
        niche: nicheStr,
        location: locationStr,
        maxResults: perLocationMax,
        radius,
      });

      if (!result.ok) {
        res.status(422).json({ error: result.error.code, message: result.error.message });
        return;
      }

      totalLeadsQueued += result.data.leadsQueued;
      totalDuplicatesSkipped += result.data.duplicatesSkipped;
      sourceBreakdown.google += result.data.sourceBreakdown.google;
      sourceBreakdown.places += result.data.sourceBreakdown.places;
    }

    res.status(200).json({
      data: {
        leadsQueued: totalLeadsQueued,
        duplicatesSkipped: totalDuplicatesSkipped,
        sourceBreakdown,
        locationsSearched: locations.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/leads ────────────────────────────────────────────────────────────
// Manually add a prospect. consentState defaults to "unknown".

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req;
    const { businessName, domain, phone, email, address, niche } = req.body as {
      businessName: string;
      domain?:      string;
      phone?:       string;
      email?:       string;
      address?:     string;
      niche?:       string;
    };

    if (!businessName?.trim()) {
      res.status(400).json({ error: "INVALID_INPUT", message: "businessName is required" });
      return;
    }

    const [row] = await db
      .insert(prospectsRaw)
      .values({
        tenantId,
        source:       "inbound_form",
        businessName: businessName.trim(),
        domain:       domain?.trim()   || null,
        phone:        phone?.trim()    || null,
        email:        email?.trim()    || null,
        address:      address?.trim()  || null,
        niche:        niche?.trim()    || null,
        consentState: "unknown",
      })
      .returning();

    res.status(201).json({ data: row });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/leads/:id/research ─────────────────────────────────────────────
// Enqueue a research job. quotaCheck runs first to gate on daily token budget.

router.post(
  "/:id/research",
  quotaCheck("research"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId } = req;
      const { id } = req.params;

      const prospect = await db.query.prospectsRaw.findFirst({
        where: and(eq(prospectsRaw.tenantId, tenantId), eq(prospectsRaw.id, id)),
      });

      if (!prospect) {
        res.status(404).json({ error: "NOT_FOUND", message: "Prospect not found" });
        return;
      }

      const job = await researchQueue.add("research", {
        tenantId,
        prospectId: id,
        domain:     prospect.domain ?? "",
      });

      res.status(202).json({ jobId: job.id, status: "queued" });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /api/leads/:id/outreach ─────────────────────────────────────────────
// Enqueue an outreach job. Requires sequenceId + channel in the request body.

router.post(
  "/:id/outreach",
  quotaCheck("outreach"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId } = req;
      const { id } = req.params;
      const { sequenceId, channel } = req.body as {
        sequenceId: string;
        channel:    "email" | "sms";
      };

      if (!sequenceId) {
        res.status(400).json({ error: "INVALID_INPUT", message: "sequenceId is required" });
        return;
      }
      if (channel !== "email" && channel !== "sms") {
        res.status(400).json({ error: "INVALID_INPUT", message: "channel must be 'email' or 'sms'" });
        return;
      }

      const prospect = await db.query.prospectsRaw.findFirst({
        where: and(eq(prospectsRaw.tenantId, tenantId), eq(prospectsRaw.id, id)),
      });

      if (!prospect) {
        res.status(404).json({ error: "NOT_FOUND", message: "Prospect not found" });
        return;
      }

      const job = await outreachQueue.add("outreach", {
        tenantId,
        prospectId: id,
        sequenceId,
        channel,
      });

      res.status(202).json({ jobId: job.id, status: "queued" });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /api/leads/:id/messages ──────────────────────────────────────────────
// List all message_attempts for a prospect, newest first.

router.get("/:id/messages", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req;
    const { id } = req.params;

    const messages = await db
      .select()
      .from(messageAttempts)
      .where(
        and(
          eq(messageAttempts.tenantId, tenantId),
          eq(messageAttempts.prospectId, id),
        ),
      )
      .orderBy(desc(messageAttempts.createdAt));

    res.json({ data: messages });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/leads/messages/:messageId ─────────────────────────────────────
// Approve or revert a message draft. Only transitions from pending_approval are allowed.
//   status: "approved" — ready for sending
//   status: "draft"    — soft reject: back to draft for editing

router.patch("/messages/:messageId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req;
    const { messageId } = req.params;
    const { status } = req.body as { status: string };

    const allowed = ["approved", "draft"] as const;
    type Allowed = typeof allowed[number];

    if (!allowed.includes(status as Allowed)) {
      res.status(400).json({
        error:   "INVALID_INPUT",
        message: `status must be one of: ${allowed.join(", ")}`,
      });
      return;
    }

    const [updated] = await db
      .update(messageAttempts)
      .set({ status: status as Allowed })
      .where(
        and(
          eq(messageAttempts.tenantId, tenantId),
          eq(messageAttempts.id, messageId),
          eq(messageAttempts.status, "pending_approval"),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({
        error:   "NOT_FOUND",
        message: "Message not found or not in pending_approval state",
      });
      return;
    }

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
