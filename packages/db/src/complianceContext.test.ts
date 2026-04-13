import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveOutboundComplianceContextFromAttempt,
  resolveOutboundComplianceContextFromInput,
} from "./complianceContext";

test("resolves compliance context from enqueue input body", () => {
  const ctx = resolveOutboundComplianceContextFromInput({
    body: {
      campaign: {
        id: "cmp_123",
        sellerName: "Acme Seller",
        automated: false,
      },
    },
    defaultSellerName: "Tenant Name",
  });

  assert.equal(ctx.campaignId, "cmp_123");
  assert.equal(ctx.sellerName, "Acme Seller");
  assert.equal(ctx.automated, false);
});

test("falls back to tenant seller name and automated=true", () => {
  const ctx = resolveOutboundComplianceContextFromInput({
    body: {},
    defaultSellerName: "Tenant Name",
  });

  assert.equal(ctx.campaignId, null);
  assert.equal(ctx.sellerName, "Tenant Name");
  assert.equal(ctx.automated, true);
});

test("resolves worker compliance context from call attempt fields", () => {
  const ctx = resolveOutboundComplianceContextFromAttempt({
    campaignId: "cmp_999",
    complianceSellerName: "Campaign Seller",
    complianceAutomated: true,
    defaultSellerName: "Tenant Name",
  });

  assert.equal(ctx.campaignId, "cmp_999");
  assert.equal(ctx.sellerName, "Campaign Seller");
  assert.equal(ctx.automated, true);
});
