const OPT_OUT_TEXT_PATTERN = /\b(stop|unsubscribe|do not call|dont call|don't call|remove me|opt out|dnd|revoke consent)\b/i;

const OPT_OUT_DISPOSITIONS = new Set([
  "verbal_optout",
  "stop_reply",
  "do_not_contact",
  "unsubscribe",
  "revoked",
  "opt_out",
  "dnc",
]);

export function isOptOutText(value: string): boolean {
  return OPT_OUT_TEXT_PATTERN.test(String(value ?? "").trim());
}

export function isOptOutDisposition(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return OPT_OUT_DISPOSITIONS.has(normalized);
}

export function resolveInboundSuppressionType(params: {
  channel?: string | null;
  disposition?: string | null;
}): "verbal_optout" | "stop_reply" {
  const channel = String(params.channel ?? "").trim().toLowerCase();
  const disposition = String(params.disposition ?? "").trim().toLowerCase();
  if (disposition === "verbal_optout" || channel === "voice") {
    return "verbal_optout";
  }
  return "stop_reply";
}
