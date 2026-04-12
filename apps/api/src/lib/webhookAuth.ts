import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_WEBHOOK_AGE_SECONDS = 5 * 60;

function getInternalWebhookSecret(): string {
  const secret = String(process.env.WEBHOOK_SECRET ?? "").trim();
  if (!secret) {
    throw new Error("WEBHOOK_SECRET is not configured");
  }
  return secret;
}

function computeSignature(timestamp: string, rawBody: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
}

export function signInternalWebhook(params: { timestamp: string; rawBody: string }): string {
  return computeSignature(params.timestamp, params.rawBody, getInternalWebhookSecret());
}

export function verifyInternalWebhookSignature(params: {
  timestamp: string;
  rawBody: string;
  providedSignature: string;
}): { ok: true } | { ok: false; message: string } {
  if (!params.timestamp || !params.providedSignature) {
    return { ok: false, message: "Missing webhook timestamp or signature" };
  }

  const timestampMs = Number(params.timestamp);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, message: "Invalid webhook timestamp" };
  }

  if (Math.abs(Date.now() - timestampMs) > MAX_WEBHOOK_AGE_SECONDS * 1000) {
    return { ok: false, message: "Webhook timestamp is stale" };
  }

  const secret = getInternalWebhookSecret();
  const expected = computeSignature(params.timestamp, params.rawBody, secret);

  try {
    const providedBuffer = Buffer.from(params.providedSignature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    if (
      providedBuffer.length !== expectedBuffer.length
      || !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      return { ok: false, message: "Invalid webhook signature" };
    }
  } catch {
    return { ok: false, message: "Invalid webhook signature" };
  }

  return { ok: true };
}
