import test from "node:test";
import assert from "node:assert/strict";

import { isOptOutDisposition, isOptOutText, resolveInboundSuppressionType } from "./optOut";

test("isOptOutText recognizes common TCPA opt-out phrases", () => {
  assert.equal(isOptOutText("STOP"), true);
  assert.equal(isOptOutText("Please do not call me"), true);
  assert.equal(isOptOutText("Can you revoke consent?"), true);
  assert.equal(isOptOutText("tell me your pricing"), false);
});

test("isOptOutDisposition handles supported dispositions", () => {
  assert.equal(isOptOutDisposition("verbal_optout"), true);
  assert.equal(isOptOutDisposition("DO_NOT_CONTACT"), true);
  assert.equal(isOptOutDisposition("opt_out"), true);
  assert.equal(isOptOutDisposition("answered"), false);
});

test("resolveInboundSuppressionType maps voice to verbal_optout", () => {
  assert.equal(resolveInboundSuppressionType({ channel: "voice", disposition: "stop_reply" }), "verbal_optout");
  assert.equal(resolveInboundSuppressionType({ channel: "sms", disposition: "verbal_optout" }), "verbal_optout");
  assert.equal(resolveInboundSuppressionType({ channel: "sms", disposition: "stop_reply" }), "stop_reply");
});
