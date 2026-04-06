// Escalation notification helper — fire-and-forget alerts when a session escalates.
// Sends SMS via SignalWire and email via SendGrid if credentials are configured.

import { db } from "@qyro/db";
import { auditLogs } from "@qyro/db";
import { publishRealtimeEvent } from "@qyro/queue";

export interface EscalationParams {
  tenantId: string;
  sessionId: string;
  prospectName: string;
  prospectPhone: string | null;
  escalationContactPhone: string | null;
  escalationContactEmail: string | null;
  /** Caller's phone number that QYRO answers from (tenant's voiceNumber) — used as SMS From */
  fromNumber: string | null;
  escalationReason?: string;
  appBaseUrl?: string;
}

function buildAlertBody(params: EscalationParams): string {
  const sessionLink = `${params.appBaseUrl ?? "https://app.qyro.us"}/client/conversations?sessionId=${encodeURIComponent(params.sessionId)}`;
  const customer = params.prospectName || params.prospectPhone || "Unknown customer";
  return `QYRO Alert: Customer ${customer} needs immediate assistance. Session: ${sessionLink}`;
}

async function sendSmsAlert(params: EscalationParams): Promise<void> {
  const { escalationContactPhone, fromNumber } = params;
  if (!escalationContactPhone || !fromNumber) return;

  const projectId = process.env.SIGNALWIRE_PROJECT_ID;
  const apiToken  = process.env.SIGNALWIRE_API_TOKEN;
  const spaceUrl  = (process.env.SIGNALWIRE_SPACE_URL ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");

  if (!projectId || !apiToken || !spaceUrl) {
    console.warn("[escalation] SMS skipped — SignalWire env vars missing");
    return;
  }

  const form = new URLSearchParams();
  form.set("To",   escalationContactPhone);
  form.set("From", fromNumber);
  form.set("Body", buildAlertBody(params));

  try {
    const res = await fetch(
      `https://${spaceUrl}/api/laml/2010-04-01/Accounts/${encodeURIComponent(projectId)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${projectId}:${apiToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      console.error(`[escalation] SMS alert failed ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.error("[escalation] SMS alert error:", err);
  }
}

async function sendEmailAlert(params: EscalationParams): Promise<void> {
  const { escalationContactEmail } = params;
  if (!escalationContactEmail) return;

  const apiKey   = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL ?? "no-reply@qyro.us";

  if (!apiKey) {
    console.warn("[escalation] Email skipped — SENDGRID_API_KEY not configured");
    return;
  }

  const customer = params.prospectName || params.prospectPhone || "Unknown customer";
  const sessionLink = `${params.appBaseUrl ?? "https://app.qyro.us"}/client/conversations?sessionId=${encodeURIComponent(params.sessionId)}`;
  const text = [
    `A customer requires immediate attention.`,
    ``,
    `Customer: ${customer}`,
    `Phone: ${params.prospectPhone ?? "unknown"}`,
    `Reason: ${params.escalationReason ?? "escalation requested"}`,
    `Session: ${sessionLink}`,
    ``,
    `— QYRO Assist`,
  ].join("\n");

  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: escalationContactEmail }] }],
        from: { email: fromEmail, name: "QYRO Assist" },
        subject: `QYRO Alert: ${customer} needs assistance`,
        content: [{ type: "text/plain", value: text }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[escalation] Email alert failed ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.error("[escalation] Email alert error:", err);
  }
}

/**
 * Fire-and-forget escalation notifications. Sends SMS + email alerts and logs to audit_logs.
 * Never throws — safe to call without awaiting.
 */
export function triggerEscalationNotifications(params: EscalationParams): void {
  Promise.allSettled([
    sendSmsAlert(params),
    sendEmailAlert(params),
    publishRealtimeEvent({
      type: "escalation",
      tenantId: params.tenantId,
      payload: {
        sessionId: params.sessionId,
        customer: params.prospectName || params.prospectPhone || "Unknown customer",
        prospectPhone: params.prospectPhone,
        reason: params.escalationReason ?? "escalation requested",
      },
    }),
    db.insert(auditLogs).values({
      tenantId: params.tenantId,
      action: "escalation.triggered",
      resourceType: "session",
      resourceId: params.sessionId,
      after: {
        prospectName: params.prospectName,
        prospectPhone: params.prospectPhone,
        reason: params.escalationReason ?? null,
        smsAlertSent: !!params.escalationContactPhone,
        emailAlertSent: !!params.escalationContactEmail,
      },
    }),
  ]).catch((err) => {
    console.error("[escalation] notification batch error:", err);
  });
}
