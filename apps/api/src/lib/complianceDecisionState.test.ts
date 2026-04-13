import test from "node:test";
import assert from "node:assert/strict";

import { validateReopenTransition, validateResolveTransition } from "./complianceDecisionState";

test("validateResolveTransition allows open BLOCK decision", () => {
  const result = validateResolveTransition({ decision: "BLOCK", resolvedAt: null });
  assert.deepEqual(result, { ok: true });
});

test("validateResolveTransition rejects already resolved decision", () => {
  const result = validateResolveTransition({ decision: "MANUAL_REVIEW", resolvedAt: new Date() });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "ALREADY_RESOLVED");
});

test("validateResolveTransition rejects non-actionable decision", () => {
  const result = validateResolveTransition({ decision: "ALLOW", resolvedAt: null });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "INVALID_STATE");
});

test("validateReopenTransition allows resolved BLOCK decision", () => {
  const result = validateReopenTransition({ decision: "BLOCK", resolvedAt: new Date() });
  assert.deepEqual(result, { ok: true });
});

test("validateReopenTransition rejects already open decision", () => {
  const result = validateReopenTransition({ decision: "BLOCK", resolvedAt: null });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "ALREADY_OPEN");
});

test("validateReopenTransition rejects non-actionable decision", () => {
  const result = validateReopenTransition({ decision: "ALLOW", resolvedAt: new Date() });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "INVALID_STATE");
});
