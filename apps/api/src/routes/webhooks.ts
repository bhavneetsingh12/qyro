// Inbound webhook routes (Stripe, Clerk, Cal.com, Twilio, internal ops)
// Internal ops webhooks are protected by INTERNAL_WEBHOOK_SECRET.

import { Router, type Request, type Response, type NextFunction, type Router as ExpressRouter } from "express";
import { db, prospectsRaw, prospectsEnriched, messageAttempts } from "@qyro/db";
import { and, eq, gte, inArray } from "drizzle-orm";
import { runLeadDiscovery } from "@qyro/agents/leadDiscovery";
import { outreachQueue } from "@qyro/queue";

const router: ExpressRouter = Router();

type NightlyOutreachConfig = {
	sequenceId: string;
	channel?: "email" | "sms";
	minUrgency?: number;
	maxDrafts?: number;
};

type NightlyRun = {
	tenantId: string;
	niche: string;
	location: string | { locations: string[]; radius?: number };
	maxResults?: number;
	outreach?: NightlyOutreachConfig;
};

function priorityFromUrgency(urgencyScore: number | null | undefined): 1 | 2 | 3 {
	const score = Number(urgencyScore ?? 0);
	if (score >= 8) return 1;
	if (score >= 5) return 2;
	return 3;
}

type MorningDigestRun = {
	tenantId: string;
	lookbackHours?: number;
};

function ensureInternalSecret(req: Request, res: Response): boolean {
	const expected = process.env.INTERNAL_WEBHOOK_SECRET;
	if (!expected) {
		res.status(500).json({ error: "CONFIG_ERROR", message: "INTERNAL_WEBHOOK_SECRET not configured" });
		return false;
	}
	const provided = req.header("x-internal-webhook-secret");
	if (!provided || provided !== expected) {
		res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid internal webhook secret" });
		return false;
	}
	return true;
}

async function queueOutreachDrafts(params: {
	tenantId: string;
	niche: string;
	startedAt: Date;
	outreach: NightlyOutreachConfig;
}): Promise<{ queued: number; considered: number }> {
	const { tenantId, niche, startedAt, outreach } = params;
	const channel = outreach.channel ?? "email";
	const maxDrafts = Math.max(1, Math.min(200, outreach.maxDrafts ?? 25));
	const minUrgency = outreach.minUrgency;

	const recentProspects = await db
		.select({
			prospectId: prospectsRaw.id,
			urgencyScore: prospectsEnriched.urgencyScore,
		})
		.from(prospectsRaw)
		.leftJoin(prospectsEnriched, and(
			eq(prospectsEnriched.tenantId, prospectsRaw.tenantId),
			eq(prospectsEnriched.prospectId, prospectsRaw.id),
		))
		.where(and(
			eq(prospectsRaw.tenantId, tenantId),
			eq(prospectsRaw.niche, niche),
			gte(prospectsRaw.createdAt, startedAt),
		));

	let candidateProspects = recentProspects
		.filter((row) => minUrgency === undefined || (row.urgencyScore ?? 0) >= minUrgency)
		.map((row) => ({ prospectId: row.prospectId, urgencyScore: row.urgencyScore }));

  const deduped = new Map<string, number | null>();
  for (const row of candidateProspects) {
    if (!deduped.has(row.prospectId)) deduped.set(row.prospectId, row.urgencyScore ?? null);
  }
  candidateProspects = Array.from(deduped.entries())
    .map(([prospectId, urgencyScore]) => ({ prospectId, urgencyScore }))
    .slice(0, maxDrafts);

	if (candidateProspects.length === 0) {
		return { queued: 0, considered: 0 };
	}

	const candidateIds = candidateProspects.map((row) => row.prospectId);

	// Avoid duplicate drafts for same sequence + prospect.
	const existing = await db
		.select({ prospectId: messageAttempts.prospectId })
		.from(messageAttempts)
		.where(and(
			eq(messageAttempts.tenantId, tenantId),
			eq(messageAttempts.sequenceId, outreach.sequenceId),
			inArray(messageAttempts.prospectId, candidateIds),
			eq(messageAttempts.direction, "outbound"),
		));

	const existingIds = new Set(existing.map((row) => row.prospectId));
	const toQueue = candidateProspects.filter((row) => !existingIds.has(row.prospectId));

	if (toQueue.length > 0) {
		await outreachQueue.addBulk(
			toQueue.map((row) => ({
				name: "outreach",
				data: {
					tenantId,
					prospectId: row.prospectId,
					sequenceId: outreach.sequenceId,
					channel,
				},
				opts: {
					priority: priorityFromUrgency(row.urgencyScore),
				},
			})),
		);
	}

	return { queued: toQueue.length, considered: candidateIds.length };
}

// POST /webhooks/nightly/ingest
// Triggered by n8n nightly schedule. Runs discovery and optional outreach drafting.
router.post("/nightly/ingest", async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!ensureInternalSecret(req, res)) return;

		const { runs } = req.body as { runs?: NightlyRun[] };
		if (!Array.isArray(runs) || runs.length === 0) {
			res.status(400).json({ error: "INVALID_INPUT", message: "runs[] is required" });
			return;
		}

		const perRun: Array<Record<string, unknown>> = [];
		let totalLeadsQueued = 0;
		let totalDuplicatesSkipped = 0;
		let totalOutreachQueued = 0;

		for (const run of runs) {
			const startedAt = new Date();
			const maxResults = Math.max(1, Math.min(50, run.maxResults ?? 15));

			const normalizedLocation = typeof run.location === "string" ? run.location : run.location.locations.join(", ");
			const discovery = await runLeadDiscovery({
				tenantId: run.tenantId,
				niche: run.niche,
				location: normalizedLocation,
				maxResults,
			});

			if (!discovery.ok) {
				perRun.push({
					tenantId: run.tenantId,
					niche: run.niche,
					ok: false,
					error: discovery.error,
				});
				continue;
			}

			totalLeadsQueued += discovery.data.leadsQueued;
			totalDuplicatesSkipped += discovery.data.duplicatesSkipped;

			let outreachQueued = 0;
			let outreachConsidered = 0;
			if (run.outreach?.sequenceId) {
				const warm = await queueOutreachDrafts({
					tenantId: run.tenantId,
					niche: run.niche,
					startedAt,
					outreach: run.outreach,
				});
				outreachQueued = warm.queued;
				outreachConsidered = warm.considered;
				totalOutreachQueued += outreachQueued;
			}

			perRun.push({
				tenantId: run.tenantId,
				niche: run.niche,
				ok: true,
				leadsQueued: discovery.data.leadsQueued,
				duplicatesSkipped: discovery.data.duplicatesSkipped,
				sourceBreakdown: discovery.data.sourceBreakdown,
				outreachQueued,
				outreachConsidered,
			});
		}

		res.json({
			data: {
				runs: perRun,
				totals: {
					leadsQueued: totalLeadsQueued,
					duplicatesSkipped: totalDuplicatesSkipped,
					outreachQueued: totalOutreachQueued,
				},
			},
		});
	} catch (err) {
		next(err);
	}
});

// POST /webhooks/morning/digest
// Triggered by n8n in the morning to summarize overnight pipeline health.
router.post("/morning/digest", async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!ensureInternalSecret(req, res)) return;

		const { runs } = req.body as { runs?: MorningDigestRun[] };
		if (!Array.isArray(runs) || runs.length === 0) {
			res.status(400).json({ error: "INVALID_INPUT", message: "runs[] is required" });
			return;
		}

		const perRun: Array<Record<string, unknown>> = [];
		let totalNewProspects = 0;
		let totalPendingApproval = 0;
		let totalApproved = 0;
		let totalBlocked = 0;

		for (const run of runs) {
			const lookbackHours = Math.max(1, Math.min(72, run.lookbackHours ?? 12));
			const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

			const [newProspectsRows, pendingRows, approvedRows, blockedRows, pendingTotalRows] = await Promise.all([
				db
					.select({ id: prospectsRaw.id })
					.from(prospectsRaw)
					.where(and(
						eq(prospectsRaw.tenantId, run.tenantId),
						gte(prospectsRaw.createdAt, since),
					)),
				db
					.select({ id: messageAttempts.id })
					.from(messageAttempts)
					.where(and(
						eq(messageAttempts.tenantId, run.tenantId),
						eq(messageAttempts.status, "pending_approval"),
						gte(messageAttempts.createdAt, since),
					)),
				db
					.select({ id: messageAttempts.id })
					.from(messageAttempts)
					.where(and(
						eq(messageAttempts.tenantId, run.tenantId),
						eq(messageAttempts.status, "approved"),
						gte(messageAttempts.createdAt, since),
					)),
				db
					.select({ id: messageAttempts.id })
					.from(messageAttempts)
					.where(and(
						eq(messageAttempts.tenantId, run.tenantId),
						eq(messageAttempts.status, "blocked_by_qa"),
						gte(messageAttempts.createdAt, since),
					)),
				db
					.select({ id: messageAttempts.id })
					.from(messageAttempts)
					.where(and(
						eq(messageAttempts.tenantId, run.tenantId),
						eq(messageAttempts.status, "pending_approval"),
					)),
			]);

			const newProspects = newProspectsRows.length;
			const pendingApproval = pendingRows.length;
			const approved = approvedRows.length;
			const blocked = blockedRows.length;
			const pendingApprovalTotal = pendingTotalRows.length;

			totalNewProspects += newProspects;
			totalPendingApproval += pendingApproval;
			totalApproved += approved;
			totalBlocked += blocked;

			perRun.push({
				tenantId: run.tenantId,
				lookbackHours,
				since: since.toISOString(),
				newProspects,
				pendingApproval,
				approved,
				blocked,
				pendingApprovalTotal,
			});
		}

		res.json({
			data: {
				runs: perRun,
				totals: {
					newProspects: totalNewProspects,
					pendingApproval: totalPendingApproval,
					approved: totalApproved,
					blocked: totalBlocked,
				},
			},
		});
	} catch (err) {
		next(err);
	}
});

export default router;
