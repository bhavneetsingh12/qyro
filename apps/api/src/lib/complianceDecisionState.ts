export type ComplianceDecisionKind = "ALLOW" | "BLOCK" | "MANUAL_REVIEW" | string;

export function validateResolveTransition(params: {
  decision: ComplianceDecisionKind;
  resolvedAt: Date | null;
}): { ok: true } | { ok: false; code: "INVALID_STATE" | "ALREADY_RESOLVED"; message: string } {
  if (params.decision !== "BLOCK" && params.decision !== "MANUAL_REVIEW") {
    return {
      ok: false,
      code: "INVALID_STATE",
      message: "Only BLOCK or MANUAL_REVIEW decisions can be resolved",
    };
  }
  if (params.resolvedAt) {
    return {
      ok: false,
      code: "ALREADY_RESOLVED",
      message: "Compliance decision is already resolved",
    };
  }
  return { ok: true };
}

export function validateReopenTransition(params: {
  decision: ComplianceDecisionKind;
  resolvedAt: Date | null;
}): { ok: true } | { ok: false; code: "INVALID_STATE" | "ALREADY_OPEN"; message: string } {
  if (params.decision !== "BLOCK" && params.decision !== "MANUAL_REVIEW") {
    return {
      ok: false,
      code: "INVALID_STATE",
      message: "Only BLOCK or MANUAL_REVIEW decisions can be reopened",
    };
  }
  if (!params.resolvedAt) {
    return {
      ok: false,
      code: "ALREADY_OPEN",
      message: "Compliance decision is already open",
    };
  }
  return { ok: true };
}
