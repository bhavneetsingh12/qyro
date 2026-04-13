export type ComplianceDigestAlert = {
  code: string;
  level: "info" | "warning";
  message: string;
};

export function buildComplianceDigestAlerts(params: {
  complianceAllow: number;
  complianceBlock: number;
  complianceManualReview: number;
  complianceOpen: number;
  oldestOpenAgeHours?: number | null;
}): ComplianceDigestAlert[] {
  const alerts: ComplianceDigestAlert[] = [];

  if (params.complianceOpen >= 25) {
    alerts.push({
      code: "open_queue_high",
      level: "warning",
      message: `Open compliance queue is high (${params.complianceOpen}).`,
    });
  }

  if (params.complianceManualReview >= 15) {
    alerts.push({
      code: "manual_review_spike",
      level: "warning",
      message: `Manual review decisions spiked in lookback window (${params.complianceManualReview}).`,
    });
  }

  if (params.complianceBlock >= 15) {
    alerts.push({
      code: "blocked_spike",
      level: "warning",
      message: `Blocked compliance decisions spiked in lookback window (${params.complianceBlock}).`,
    });
  }

  const complianceTotal = params.complianceAllow + params.complianceBlock + params.complianceManualReview;
  if (complianceTotal >= 10) {
    const blockedShare = Math.round(((params.complianceBlock + params.complianceManualReview) / complianceTotal) * 100);
    if (blockedShare >= 50) {
      alerts.push({
        code: "blocked_ratio_high",
        level: "warning",
        message: `High blocked/manual-review ratio (${blockedShare}%).`,
      });
    }
  }

  const oldestOpenAgeHours = Number(params.oldestOpenAgeHours ?? 0);
  if (Number.isFinite(oldestOpenAgeHours) && oldestOpenAgeHours >= 24) {
    alerts.push({
      code: "open_queue_stale",
      level: "warning",
      message: `Oldest unresolved compliance decision is ${Math.round(oldestOpenAgeHours)}h old.`,
    });
  }

  return alerts;
}
