// Inbound webhook routes (Stripe and internal scheduled ops)
// Internal ops webhooks are signed with WEBHOOK_SECRET using timestamped HMAC.

import { Router, type Request, type Response, type NextFunction, type Router as ExpressRouter } from "express";
import { db, tenants, prospectsRaw, prospectsEnriched, messageAttempts, callAttempts, dailySummaries, complianceDecisions } from "@qyro/db";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { runLeadDiscovery } from "@qyro/agents/leadDiscovery";
import { outreachQueue, redis } from "@qyro/queue";
import { verifyInternalWebhookSignature } from "../lib/webhookAuth";

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

function utcDayString(date = new Date()): string {
	return date.toISOString().slice(0, 10);
}

function intentCounterKeys(tenantId: string, day: string) {
	const prefix = `daily_summary:intent:${tenantId}:${day}`;
	return {
		questions: `${prefix}:questions_count`,
		bookings: `${prefix}:appointments_booked_count`,
		escalations: `${prefix}:escalations_count`,
	};
}

async function ensureInternalSecret(req: Request, res: Response): Promise<boolean> {
	const timestamp = String(req.header("x-webhook-timestamp") ?? "").trim();
	const signature = String(req.header("x-webhook-signature") ?? "").trim();
	const rawBody = ((req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from("")).toString("utf8");

	const verified = verifyInternalWebhookSignature({
		timestamp,
		rawBody,
		providedSignature: signature,
	});
	if (!verified.ok) {
		res.status(401).json({ error: "UNAUTHORIZED", message: verified.message });
		return false;
	}

	const replayKey = `webhook:replay:${timestamp}:${signature}`;
	const replayResult = await redis.set(replayKey, "1", "EX", 5 * 60, "NX");
	if (replayResult !== "OK") {
		res.status(409).json({ error: "REPLAY_DETECTED", message: "Webhook signature has already been used" });
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
// Triggered by the nightly Railway cron service. Runs discovery and optional outreach drafting.
router.post("/nightly/ingest", async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!await ensureInternalSecret(req, res)) return;

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
// Triggered by the morning Railway cron service to summarize overnight pipeline health.
router.post("/morning/digest", async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!await ensureInternalSecret(req, res)) return;

		let { runs } = req.body as { runs?: MorningDigestRun[] };
		if (!Array.isArray(runs) || runs.length === 0) {
			// Auto-discover all active tenants when no runs array is provided
			const allTenants = await db.select({ id: tenants.id }).from(tenants);
			runs = allTenants.map((t) => ({ tenantId: t.id, lookbackHours: 12 }));
		}
		if (runs.length === 0) {
			res.json({ data: { runs: [], totals: {} } });
			return;
		}

		const perRun: Array<Record<string, unknown>> = [];
		let totalNewProspects = 0;
		let totalPendingApproval = 0;
		let totalApproved = 0;
		let totalBlocked = 0;
		let totalCallsHandled = 0;
		let totalAppointmentsBooked = 0;
		let totalEscalations = 0;
		let totalQuestions = 0;
		let totalComplianceAllow = 0;
		let totalComplianceBlock = 0;
		let totalComplianceManualReview = 0;
		let totalComplianceOpen = 0;
		let totalUrgencyWeighted = 0;
		let totalUrgencyContributors = 0;
		const digestDate = utcDayString();

		for (const run of runs) {
			const lookbackHours = Math.max(1, Math.min(72, run.lookbackHours ?? 12));
			const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
			const intentKeys = intentCounterKeys(run.tenantId, digestDate);

			const [newProspectsRows, pendingRows, approvedRows, blockedRows, pendingTotalRows, callsRows, urgencyRows, intentValues, complianceWindowRows, complianceOpenRows] = await Promise.all([
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
				db
					.select({ id: callAttempts.id })
					.from(callAttempts)
					.where(and(
						eq(callAttempts.tenantId, run.tenantId),
						gte(callAttempts.createdAt, since),
					)),
				db
					.select({
						urgency: prospectsEnriched.urgencyScore,
					})
					.from(prospectsEnriched)
					.where(and(
						eq(prospectsEnriched.tenantId, run.tenantId),
						gte(prospectsEnriched.researchedAt, since),
					)),
				redis.mget(intentKeys.questions, intentKeys.bookings, intentKeys.escalations),
				db
					.select({
						decision: complianceDecisions.decision,
						count: sql<number>`count(*)`,
					})
					.from(complianceDecisions)
					.where(and(
						eq(complianceDecisions.tenantId, run.tenantId),
						gte(complianceDecisions.evaluatedAt, since),
					))
					.groupBy(complianceDecisions.decision),
				db
					.select({ id: complianceDecisions.id })
					.from(complianceDecisions)
					.where(and(
						eq(complianceDecisions.tenantId, run.tenantId),
						inArray(complianceDecisions.decision, ["BLOCK", "MANUAL_REVIEW"]),
						isNull(complianceDecisions.resolvedAt),
					)),
			]);

			const newProspects = newProspectsRows.length;
			const pendingApproval = pendingRows.length;
			const approved = approvedRows.length;
			const blocked = blockedRows.length;
			const pendingApprovalTotal = pendingTotalRows.length;
			const callsHandled = callsRows.length;

			const urgencyValues = urgencyRows
				.map((row) => Number(row.urgency ?? 0))
				.filter((value) => Number.isFinite(value) && value > 0);
			const avgUrgencyScore = urgencyValues.length > 0
				? Math.round(urgencyValues.reduce((sum, value) => sum + value, 0) / urgencyValues.length)
				: null;

			const questionsCount = Number.parseInt(String(intentValues[0] ?? "0"), 10) || 0;
			const appointmentsBookedCount = Number.parseInt(String(intentValues[1] ?? "0"), 10) || 0;
			const escalationsCount = Number.parseInt(String(intentValues[2] ?? "0"), 10) || 0;
			const complianceAllow = complianceWindowRows.find((row) => row.decision === "ALLOW")?.count ?? 0;
			const complianceBlock = complianceWindowRows.find((row) => row.decision === "BLOCK")?.count ?? 0;
			const complianceManualReview = complianceWindowRows.find((row) => row.decision === "MANUAL_REVIEW")?.count ?? 0;
			const complianceOpen = complianceOpenRows.length;

			await redis.del(intentKeys.questions, intentKeys.bookings, intentKeys.escalations);

			await db
				.insert(dailySummaries)
				.values({
					tenantId: run.tenantId,
					date: digestDate,
					newProspectsCount: newProspects,
					pendingApprovalCount: pendingApproval,
					approvedCount: approved,
					blockedCount: blocked,
					callsHandledCount: callsHandled,
					appointmentsBookedCount,
					escalationsCount,
					questionsCount,
					avgUrgencyScore,
				})
				.onConflictDoUpdate({
					target: [dailySummaries.tenantId, dailySummaries.date],
					set: {
						newProspectsCount: newProspects,
						pendingApprovalCount: pendingApproval,
						approvedCount: approved,
						blockedCount: blocked,
						callsHandledCount: callsHandled,
						appointmentsBookedCount,
						escalationsCount,
						questionsCount,
						avgUrgencyScore,
						createdAt: sql`now()`,
					},
				});

			totalNewProspects += newProspects;
			totalPendingApproval += pendingApproval;
			totalApproved += approved;
			totalBlocked += blocked;
			totalCallsHandled += callsHandled;
			totalAppointmentsBooked += appointmentsBookedCount;
			totalEscalations += escalationsCount;
			totalQuestions += questionsCount;
			totalComplianceAllow += complianceAllow;
			totalComplianceBlock += complianceBlock;
			totalComplianceManualReview += complianceManualReview;
			totalComplianceOpen += complianceOpen;
			if (avgUrgencyScore !== null) {
				totalUrgencyWeighted += avgUrgencyScore;
				totalUrgencyContributors += 1;
			}

			perRun.push({
				tenantId: run.tenantId,
				date: digestDate,
				lookbackHours,
				since: since.toISOString(),
				newProspects,
				pendingApproval,
				approved,
				blocked,
				callsHandled,
				appointmentsBookedCount,
				escalationsCount,
				questionsCount,
				complianceAllow,
				complianceBlock,
				complianceManualReview,
				complianceOpen,
				avgUrgencyScore,
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
					callsHandled: totalCallsHandled,
					appointmentsBooked: totalAppointmentsBooked,
					escalations: totalEscalations,
					questions: totalQuestions,
					complianceAllow: totalComplianceAllow,
					complianceBlock: totalComplianceBlock,
					complianceManualReview: totalComplianceManualReview,
					complianceOpen: totalComplianceOpen,
					avgUrgencyScore: totalUrgencyContributors > 0
						? Math.round(totalUrgencyWeighted / totalUrgencyContributors)
						: null,
				},
			},
		});
	} catch (err) {
		next(err);
	}
});

export default router;
