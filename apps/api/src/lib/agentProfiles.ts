export type AssistAgentMode = "inbound" | "outbound" | "chat";

export type AgentProfile = {
  enabled: boolean;
  name: string;
  behaviorHint: string;
  allowBooking: boolean;
  allowEscalation: boolean;
};

export type TenantAgentProfiles = Record<AssistAgentMode, AgentProfile>;

const DEFAULT_PROFILES: TenantAgentProfiles = {
  inbound: {
    enabled: true,
    name: "Inbound Receptionist",
    behaviorHint: "Prioritize answering questions, booking, and escalations for incoming callers.",
    allowBooking: true,
    allowEscalation: true,
  },
  outbound: {
    enabled: true,
    name: "Outbound Prospector",
    behaviorHint: "Be concise, qualify intent quickly, respect compliance, and avoid overlong conversations.",
    allowBooking: false,
    allowEscalation: true,
  },
  chat: {
    enabled: true,
    name: "Website Chat Assistant",
    behaviorHint: "Handle FAQ and booking intent from website visitors with concise answers.",
    allowBooking: true,
    allowEscalation: true,
  },
};

function normalizeString(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : fallback;
}

function normalizeProfile(value: unknown, fallback: AgentProfile): AgentProfile {
  const raw = (value as Record<string, unknown> | null) ?? {};
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
    name: normalizeString(raw.name, fallback.name),
    behaviorHint: normalizeString(raw.behaviorHint, fallback.behaviorHint),
    allowBooking: typeof raw.allowBooking === "boolean" ? raw.allowBooking : fallback.allowBooking,
    allowEscalation: typeof raw.allowEscalation === "boolean" ? raw.allowEscalation : fallback.allowEscalation,
  };
}

export function resolveTenantAgentProfiles(metadata: unknown): TenantAgentProfiles {
  const meta = (metadata as Record<string, unknown> | null) ?? {};
  const raw = (meta.agentProfiles as Record<string, unknown> | null) ?? {};
  return {
    inbound: normalizeProfile(raw.inbound, DEFAULT_PROFILES.inbound),
    outbound: normalizeProfile(raw.outbound, DEFAULT_PROFILES.outbound),
    chat: normalizeProfile(raw.chat, DEFAULT_PROFILES.chat),
  };
}

export function mergeTenantAgentProfiles(
  metadata: unknown,
  patch: Partial<Record<AssistAgentMode, Partial<AgentProfile>>>,
): TenantAgentProfiles {
  const current = resolveTenantAgentProfiles(metadata);
  return {
    inbound: normalizeProfile({ ...current.inbound, ...(patch.inbound ?? {}) }, DEFAULT_PROFILES.inbound),
    outbound: normalizeProfile({ ...current.outbound, ...(patch.outbound ?? {}) }, DEFAULT_PROFILES.outbound),
    chat: normalizeProfile({ ...current.chat, ...(patch.chat ?? {}) }, DEFAULT_PROFILES.chat),
  };
}

export function resolveAssistantMode(params: { channel: "voice" | "chat"; direction?: "inbound" | "outbound" | null }): AssistAgentMode {
  if (params.channel === "chat") return "chat";
  return params.direction === "outbound" ? "outbound" : "inbound";
}
