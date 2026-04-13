import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveAssistantMode,
  resolveTenantAgentProfiles,
  mergeTenantAgentProfiles,
} from "./agentProfiles";

test("resolveAssistantMode maps chat and voice directions correctly", () => {
  assert.equal(resolveAssistantMode({ channel: "chat" }), "chat");
  assert.equal(resolveAssistantMode({ channel: "voice", direction: "inbound" }), "inbound");
  assert.equal(resolveAssistantMode({ channel: "voice", direction: "outbound" }), "outbound");
});

test("resolveTenantAgentProfiles falls back to defaults", () => {
  const profiles = resolveTenantAgentProfiles({});
  assert.equal(profiles.inbound.enabled, true);
  assert.equal(profiles.outbound.allowBooking, false);
  assert.equal(typeof profiles.chat.behaviorHint, "string");
});

test("mergeTenantAgentProfiles applies partial patch safely", () => {
  const merged = mergeTenantAgentProfiles(
    {
      agentProfiles: {
        outbound: { enabled: true, name: "Outbound", behaviorHint: "baseline", allowBooking: false, allowEscalation: true },
      },
    },
    {
      outbound: { enabled: false, behaviorHint: "paused by policy" },
    },
  );

  assert.equal(merged.outbound.enabled, false);
  assert.equal(merged.outbound.behaviorHint, "paused by policy");
  assert.equal(merged.outbound.allowEscalation, true);
});
