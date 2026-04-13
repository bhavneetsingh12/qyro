import test from "node:test";
import assert from "node:assert/strict";

import { buildComplianceDigestAlerts } from "./complianceDigest";

test("returns empty alerts for healthy compliance posture", () => {
  const alerts = buildComplianceDigestAlerts({
    complianceAllow: 20,
    complianceBlock: 2,
    complianceManualReview: 1,
    complianceOpen: 3,
    oldestOpenAgeHours: 2,
  });
  assert.equal(alerts.length, 0);
});

test("flags queue pressure and spikes", () => {
  const alerts = buildComplianceDigestAlerts({
    complianceAllow: 8,
    complianceBlock: 18,
    complianceManualReview: 16,
    complianceOpen: 31,
    oldestOpenAgeHours: 40,
  });

  const codes = alerts.map((row) => row.code);
  assert.ok(codes.includes("open_queue_high"));
  assert.ok(codes.includes("manual_review_spike"));
  assert.ok(codes.includes("blocked_spike"));
  assert.ok(codes.includes("blocked_ratio_high"));
  assert.ok(codes.includes("open_queue_stale"));
});

test("blocked ratio threshold is ignored on tiny sample size", () => {
  const alerts = buildComplianceDigestAlerts({
    complianceAllow: 1,
    complianceBlock: 2,
    complianceManualReview: 1,
    complianceOpen: 0,
    oldestOpenAgeHours: null,
  });
  const codes = alerts.map((row) => row.code);
  assert.equal(codes.includes("blocked_ratio_high"), false);
});

test("does not emit stale alert for recent queue age", () => {
  const alerts = buildComplianceDigestAlerts({
    complianceAllow: 2,
    complianceBlock: 1,
    complianceManualReview: 0,
    complianceOpen: 5,
    oldestOpenAgeHours: 12,
  });
  const codes = alerts.map((row) => row.code);
  assert.equal(codes.includes("open_queue_stale"), false);
});
