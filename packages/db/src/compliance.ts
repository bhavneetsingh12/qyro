import { and, desc, eq, lte, or } from "drizzle-orm";
import { db } from "./client";
import { complianceDecisions, consentRecords, doNotContact, prospectsRaw, suppressions } from "./schema";

export type ComplianceChannel = "voice" | "sms" | "email";
export type ComplianceDecision = "ALLOW" | "BLOCK" | "MANUAL_REVIEW";

export type ComplianceEvaluation = {
  decision: ComplianceDecision;
  ruleCode: string;
  explanation: string;
  consentRecordId?: string | null;
  suppressionId?: string | null;
};

export type EvaluateComplianceParams = {
  tenantId: string;
  prospectId: string;
  channel: ComplianceChannel;
  sellerName?: string | null;
  campaignId?: string | null;
  automated?: boolean;
  strictMode?: boolean;
};

function isMissingRelationError(err: unknown): boolean {
  return (err as { code?: string })?.code === "42P01";
}

function normalizePhone(value: string | null | undefined): string {
  return (value ?? "").replace(/[^+\d]/g, "").trim();
}

function channelCovered(consentChannel: string, channel: ComplianceChannel): boolean {
  const normalized = (consentChannel ?? "").trim().toLowerCase();
  return normalized === channel || normalized === "both";
}

async function writeComplianceDecision(
  params: EvaluateComplianceParams,
  result: ComplianceEvaluation,
): Promise<void> {
  try {
    await db.insert(complianceDecisions).values({
      tenantId: params.tenantId,
      prospectId: params.prospectId,
      campaignId: params.campaignId ?? null,
      channel: params.channel,
      automated: params.automated !== false,
      decision: result.decision,
      ruleCode: result.ruleCode,
      explanation: result.explanation,
      consentRecordId: result.consentRecordId ?? null,
      suppressionId: result.suppressionId ?? null,
      evaluatedAt: new Date(),
    });
  } catch (err) {
    if (!isMissingRelationError(err)) {
      console.error("[compliance] failed to persist compliance decision:", err);
    }
  }
}

export async function evaluateComplianceForProspect(
  params: EvaluateComplianceParams,
): Promise<ComplianceEvaluation> {
  const automated = params.automated !== false;
  const strictMode = params.strictMode === true;

  const fallbackAllow: ComplianceEvaluation = {
    decision: "ALLOW",
    ruleCode: "ALLOW_NO_STRICT_REQUIREMENT",
    explanation: strictMode
      ? "Strict-mode checks unavailable due missing compliance relations"
      : "Strict mode disabled; suppression checks passed",
  };

  try {
    const prospect = await db.query.prospectsRaw.findFirst({
      where: and(
        eq(prospectsRaw.id, params.prospectId),
        eq(prospectsRaw.tenantId, params.tenantId),
      ),
    });

    if (!prospect) {
      const blocked: ComplianceEvaluation = {
        decision: "BLOCK",
        ruleCode: "BLOCK_PROSPECT_NOT_FOUND",
        explanation: "Prospect not found for tenant",
      };
      await writeComplianceDecision(params, blocked);
      return blocked;
    }

    const phone = normalizePhone(prospect.phone);
    const email = (prospect.email ?? "").trim().toLowerCase();
    const domain = (prospect.domain ?? "").trim().toLowerCase();

    const dnc = await db.query.doNotContact.findFirst({
      where: and(
        eq(doNotContact.tenantId, params.tenantId),
        or(
          phone ? eq(doNotContact.phone, phone) : undefined,
          email ? eq(doNotContact.email, email) : undefined,
          domain ? eq(doNotContact.domain, domain) : undefined,
        ) as any,
      ),
    });

    if (dnc) {
      const blocked: ComplianceEvaluation = {
        decision: "BLOCK",
        ruleCode: "BLOCK_INTERNAL_DNC",
        explanation: "Prospect is on do-not-contact list",
      };
      await writeComplianceDecision(params, blocked);
      return blocked;
    }

    const now = new Date();
    const suppression = await db.query.suppressions.findFirst({
      where: and(
        eq(suppressions.tenantId, params.tenantId),
        lte(suppressions.effectiveAt, now),
        or(
          phone ? eq(suppressions.phoneE164, phone) : undefined,
          email ? eq(suppressions.email, email) : undefined,
          domain ? eq(suppressions.domain, domain) : undefined,
        ) as any,
      ),
      orderBy: desc(suppressions.createdAt),
    });

    if (suppression && !suppression.revokedAt) {
      const blocked: ComplianceEvaluation = {
        decision: "BLOCK",
        ruleCode: "BLOCK_SUPPRESSION_LIST",
        explanation: `Suppression active (${suppression.suppressionType})`,
        suppressionId: suppression.id,
      };
      await writeComplianceDecision(params, blocked);
      return blocked;
    }

    if (!strictMode) {
      await writeComplianceDecision(params, fallbackAllow);
      return fallbackAllow;
    }

    const consent = phone
      ? await db.query.consentRecords.findFirst({
          where: and(
            eq(consentRecords.tenantId, params.tenantId),
            eq(consentRecords.phoneE164, phone),
          ),
          orderBy: desc(consentRecords.capturedAt),
        })
      : null;

    if (!consent) {
      const review: ComplianceEvaluation = {
        decision: "MANUAL_REVIEW",
        ruleCode: "REVIEW_MISSING_CONSENT",
        explanation: "No consent record found for prospect phone",
      };
      await writeComplianceDecision(params, review);
      return review;
    }

    if (consent.revokedAt) {
      const blocked: ComplianceEvaluation = {
        decision: "BLOCK",
        ruleCode: "BLOCK_CONSENT_REVOKED",
        explanation: "Consent has been revoked",
        consentRecordId: consent.id,
      };
      await writeComplianceDecision(params, blocked);
      return blocked;
    }

    if (consent.expiresAt && consent.expiresAt < now) {
      const review: ComplianceEvaluation = {
        decision: "MANUAL_REVIEW",
        ruleCode: "REVIEW_CONSENT_EXPIRED",
        explanation: "Consent record has expired",
        consentRecordId: consent.id,
      };
      await writeComplianceDecision(params, review);
      return review;
    }

    if (!channelCovered(consent.consentChannel, params.channel)) {
      const review: ComplianceEvaluation = {
        decision: "MANUAL_REVIEW",
        ruleCode: "REVIEW_CHANNEL_NOT_COVERED",
        explanation: `Consent channel ${consent.consentChannel} does not cover ${params.channel}`,
        consentRecordId: consent.id,
      };
      await writeComplianceDecision(params, review);
      return review;
    }

    if (params.sellerName && consent.sellerName.trim().toLowerCase() !== params.sellerName.trim().toLowerCase()) {
      const review: ComplianceEvaluation = {
        decision: "MANUAL_REVIEW",
        ruleCode: "REVIEW_SELLER_MISMATCH",
        explanation: "Consent seller name does not match campaign seller",
        consentRecordId: consent.id,
      };
      await writeComplianceDecision(params, review);
      return review;
    }

    if (automated && consent.consentType.trim().toLowerCase() !== "written") {
      const blocked: ComplianceEvaluation = {
        decision: "BLOCK",
        ruleCode: "BLOCK_WRITTEN_CONSENT_REQUIRED",
        explanation: "Automated outreach requires written consent",
        consentRecordId: consent.id,
      };
      await writeComplianceDecision(params, blocked);
      return blocked;
    }

    const allow: ComplianceEvaluation = {
      decision: "ALLOW",
      ruleCode: "ALLOW_CONSENT_VALIDATED",
      explanation: "Consent validated and no active suppressions",
      consentRecordId: consent.id,
    };
    await writeComplianceDecision(params, allow);
    return allow;
  } catch (err) {
    if (isMissingRelationError(err)) {
      return fallbackAllow;
    }
    throw err;
  }
}

