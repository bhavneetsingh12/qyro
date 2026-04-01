// QYRO Assist routes — Session N
// Auth + tenant scoping applied upstream.
//
// Routes:
//   GET  /api/sessions      — list assistant_sessions for tenant (paginated)
//   GET  /api/appointments  — list appointments for tenant (paginated)

import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@qyro/db";
import { assistantSessions, appointments, prospectsRaw } from "@qyro/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

// ─── GET /api/sessions ─────────────────────────────────────────────────────────

router.get("/sessions", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const limit  = Math.min(parseInt((req.query.limit  as string) || "50",  10), 200);
    const offset = parseInt((req.query.offset as string) || "0", 10);

    const rows = await db
      .select({
        id:           assistantSessions.id,
        sessionType:  assistantSessions.sessionType,
        turnCount:    assistantSessions.turnCount,
        escalated:    assistantSessions.escalated,
        endedAt:      assistantSessions.endedAt,
        createdAt:    assistantSessions.createdAt,
        prospectId:   assistantSessions.prospectId,
        prospectPhone: prospectsRaw.phone,
        prospectName:  prospectsRaw.businessName,
      })
      .from(assistantSessions)
      .leftJoin(prospectsRaw, eq(assistantSessions.prospectId, prospectsRaw.id))
      .where(eq(assistantSessions.tenantId, tenantId))
      .orderBy(desc(assistantSessions.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ data: rows, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/appointments ─────────────────────────────────────────────────────

router.get("/appointments", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const limit  = Math.min(parseInt((req.query.limit  as string) || "50",  10), 200);
    const offset = parseInt((req.query.offset as string) || "0", 10);

    const rows = await db
      .select({
        id:           appointments.id,
        startAt:      appointments.startAt,
        endAt:        appointments.endAt,
        status:       appointments.status,
        notes:        appointments.notes,
        createdAt:    appointments.createdAt,
        prospectId:   appointments.prospectId,
        prospectName: prospectsRaw.businessName,
        prospectPhone: prospectsRaw.phone,
      })
      .from(appointments)
      .leftJoin(prospectsRaw, eq(appointments.prospectId, prospectsRaw.id))
      .where(eq(appointments.tenantId, tenantId))
      .orderBy(desc(appointments.startAt))
      .limit(limit)
      .offset(offset);

    res.json({ data: rows, limit, offset });
  } catch (err) {
    next(err);
  }
});

export default router;
