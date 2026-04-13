import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://postgres:postgres@localhost:5432/postgres";

import { evaluateComplianceFromSnapshot } from "./compliance";

test("blocks when on DNC list", () => {
  const result = evaluateComplianceFromSnapshot({
    strictMode: true,
    automated: true,
    channel: "voice",
    hasDoNotContact: true,
    suppression: null,
    consent: null,
  });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.ruleCode, "BLOCK_INTERNAL_DNC");
});

test("routes to manual review when strict mode enabled and consent missing", () => {
  const result = evaluateComplianceFromSnapshot({
    strictMode: true,
    automated: true,
    channel: "voice",
    hasDoNotContact: false,
    suppression: null,
    consent: null,
  });
  assert.equal(result.decision, "MANUAL_REVIEW");
  assert.equal(result.ruleCode, "REVIEW_MISSING_CONSENT");
});

test("blocks automated outreach without written consent", () => {
  const result = evaluateComplianceFromSnapshot({
    strictMode: true,
    automated: true,
    channel: "voice",
    sellerName: "Acme Dental",
    hasDoNotContact: false,
    suppression: null,
    consent: {
      id: "c1",
      consentChannel: "both",
      consentType: "express",
      sellerName: "Acme Dental",
      expiresAt: null,
      revokedAt: null,
    },
  });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.ruleCode, "BLOCK_WRITTEN_CONSENT_REQUIRED");
});

test("allows valid strict-mode consent", () => {
  const result = evaluateComplianceFromSnapshot({
    strictMode: true,
    automated: true,
    channel: "voice",
    sellerName: "Acme Dental",
    hasDoNotContact: false,
    suppression: null,
    consent: {
      id: "c2",
      consentChannel: "both",
      consentType: "written",
      sellerName: "Acme Dental",
      expiresAt: null,
      revokedAt: null,
    },
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.ruleCode, "ALLOW_CONSENT_VALIDATED");
});
