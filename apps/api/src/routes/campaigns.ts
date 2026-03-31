// QYRO Campaign (outreach sequence) routes — Task G
//
// Routes:
//   GET    /api/campaigns                — list outreach sequences (tenant-scoped)
//   GET    /api/campaigns/:id            — get one sequence
//   POST   /api/campaigns               — create a sequence
//   PATCH  /api/campaigns/:id           — update name / niche / promptPackId / active
//   DELETE /api/campaigns/:id           — soft-deactivate (active=false)
//   POST   /api/campaigns/:id/approve   — approve: sets approvedBy + approvedAt

import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@qyro/db";
import { outreachSequences } from "@qyro/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

// ─── GET /api/campaigns ────────────────────────────────────────────────────────

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req;
    const limit  = Math.min(parseInt((req.query.limit  as string) || "50",  10), 200);
    const offset = parseInt((req.query.offset as string) || "0", 10);

    const rows = await db
      .select()
      .from(outreachSequences)
      .where(eq(outreachSequences.tenantId, tenantId))
      .orderBy(desc(outreachSequences.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ data: rows, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/campaigns/:id ────────────────────────────────────────────────────

router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req;
    const { id } = req.params;

    const sequence = await db.query.outreachSequences.findFirst({
      where: and(
        eq(outreachSequences.tenantId, tenantId),
        eq(outreachSequences.id, id),
      ),
    });

    if (!sequence) {
      res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found" });
      return;
    }

    res.json({ data: sequence });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/campaigns ───────────────────────────────────────────────────────
// Create a new outreach sequence. Starts inactive — must be approved before use.

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req;
    const { name, channel, promptPackId, niche } = req.body as {
      name:         string;
      channel:      "email" | "sms" | "voice";
      promptPackId: string;
      niche?:       string;
    };

    if (!name?.trim()) {
      res.status(400).json({ error: "INVALID_INPUT", message: "name is required" });
      return;
    }
    if (channel !== "email" && channel !== "sms" && channel !== "voice") {
      res.status(400).json({ error: "INVALID_INPUT", message: "channel must be 'email', 'sms', or 'voice'" });
      return;
    }
    if (!promptPackId?.trim()) {
      res.status(400).json({ error: "INVALID_INPUT", message: "promptPackId is required" });
      return;
    }

    const [row] = await db
      .insert(outreachSequences)
      .values({
        tenantId,
        name:         name.trim(),
        channel,
        promptPackId: promptPackId.trim(),
        niche:        niche?.trim() || null,
        active:       false,
      })
      .returning();

    res.status(201).json({ data: row });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/campaigns/:id ─────────────────────────────────────────────────
// Update mutable fields. Approval state is managed via POST /:id/approve.

router.patch("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req;
    const { id } = req.params;
    const { name, niche, promptPackId, active } = req.body as {
      name?:         string;
      niche?:        string;
      promptPackId?: string;
      active?:       boolean;
    };

    const patch: Record<string, unknown> = {};
    if (name        !== undefined) patch.name         = name.trim();
    if (niche       !== undefined) patch.niche        = niche?.trim() || null;
    if (promptPackId !== undefined) patch.promptPackId = promptPackId.trim();
    if (active      !== undefined) patch.active       = active;

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "No updatable fields provided" });
      return;
    }

    const [updated] = await db
      .update(outreachSequences)
      .set(patch)
      .where(
        and(
          eq(outreachSequences.tenantId, tenantId),
          eq(outreachSequences.id, id),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found" });
      return;
    }

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/campaigns/:id ────────────────────────────────────────────────
// Soft-deactivates a sequence (active=false). Does not delete rows.

router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req;
    const { id } = req.params;

    const [updated] = await db
      .update(outreachSequences)
      .set({ active: false })
      .where(
        and(
          eq(outreachSequences.tenantId, tenantId),
          eq(outreachSequences.id, id),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found" });
      return;
    }

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/campaigns/:id/approve ─────────────────────────────────────────
// Marks the sequence as approved and activates it for use in outreach jobs.

router.post("/:id/approve", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req;
    const { id } = req.params;

    const [updated] = await db
      .update(outreachSequences)
      .set({
        active:     true,
        approvedBy: userId,
        approvedAt: new Date(),
      })
      .where(
        and(
          eq(outreachSequences.tenantId, tenantId),
          eq(outreachSequences.id, id),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found" });
      return;
    }

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
