import { createHmac, timingSafeEqual } from "node:crypto";
import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";

// Applies Clerk session verification. Rejects 401 if no valid session.
// Must come after clerkMiddleware() applied in index.ts.

export const requireClerkAuth: RequestHandler = (req, res, next) => {
  if (process.env.NODE_ENV === "production" && process.env.DEV_BYPASS_AUTH === "true") {
    res.status(500).json({ error: "CONFIG_ERROR", message: "DEV_BYPASS_AUTH cannot be enabled in production" });
    return;
  }

  if (process.env.DEV_BYPASS_AUTH === "true") {
    next();
    return;
  }

  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Authentication required" });
    return;
  }

  next();
};

// Validates that incoming requests to voice routes originated from SignalWire.
// Uses HMAC-SHA1 signature verification (same algorithm as Twilio cXML).
// Skipped in development to allow local testing without SignalWire.
export const validateSignalWireSignature: RequestHandler = (req, res, next) => {
  if (process.env.NODE_ENV !== "production") {
    next();
    return;
  }

  const apiToken = process.env.SIGNALWIRE_API_TOKEN;
  if (!apiToken) {
    console.error("[signalwire] SIGNALWIRE_API_TOKEN not set — rejecting voice request");
    res.status(403).json({ error: "FORBIDDEN", message: "SignalWire signature verification not configured" });
    return;
  }

  const signature = req.headers["x-signalwire-signature"] as string | undefined;
  if (!signature) {
    res.status(403).json({ error: "FORBIDDEN", message: "Missing SignalWire signature" });
    return;
  }

  const baseUrl = process.env.PUBLIC_API_BASE_URL ?? "";
  const url = `${baseUrl}${req.originalUrl}`;

  // SignalWire uses the same HMAC-SHA1 scheme as Twilio cXML:
  // sort POST params, append key+value pairs to URL, sign with HMAC-SHA1.
  const params: Record<string, string> = req.body ?? {};
  const sorted = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], "");
  const computed = createHmac("sha1", apiToken).update(url + sorted, "utf-8").digest("base64");

  let valid = false;
  try {
    valid = timingSafeEqual(Buffer.from(signature, "base64"), Buffer.from(computed, "base64"));
  } catch {
    valid = false;
  }

  if (!valid) {
    res.status(403).json({ error: "FORBIDDEN", message: "Invalid SignalWire signature" });
    return;
  }

  next();
};

// Validates Retell webhook/tool requests.
// Primary: HMAC-SHA256 via x-retell-signature header (provider-native).
// Fallback: shared-secret Bearer token or x-retell-secret header.
export const validateRetellRequest: RequestHandler = (req, res, next) => {
  const secret = process.env.RETELL_WEBHOOK_SECRET;
  if (!secret || secret.trim().length === 0) {
    if (process.env.NODE_ENV !== "production") {
      next();
      return;
    }
    res.status(500).json({ error: "CONFIGURATION_ERROR", message: "RETELL_WEBHOOK_SECRET is not configured" });
    return;
  }

  const key = secret.trim();

  // Provider-native: Retell signs payloads with HMAC-SHA256 using the webhook secret
  const retellSig = String(req.headers["x-retell-signature"] ?? "").trim();
  if (retellSig) {
    const rawBody: Buffer | undefined = (req as unknown as Record<string, unknown>).rawBody as Buffer | undefined;
    if (!rawBody) {
      res.status(403).json({ error: "FORBIDDEN", message: "Missing raw body for Retell signature verification" });
      return;
    }

    const expected = createHmac("sha256", key).update(rawBody).digest("hex");
    const sigBuf = Buffer.from(retellSig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)) {
      next();
      return;
    }

    res.status(403).json({ error: "FORBIDDEN", message: "Invalid Retell signature" });
    return;
  }

  // Fallback: shared-secret bearer token or x-retell-secret header
  const authHeader = String(req.headers.authorization ?? "").trim();
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const direct = String(req.headers["x-retell-secret"] ?? "").trim();
  const provided = bearer || direct;

  if (provided === key) {
    next();
    return;
  }

  if (process.env.NODE_ENV === "production") {
    res.status(403).json({ error: "FORBIDDEN", message: "Invalid Retell authentication" });
    return;
  }

  next();
};

// Extracts Clerk userId from the verified session. Safe to call after requireClerkAuth.
export function getClerkUserId(req: Parameters<RequestHandler>[0]): string {
  const { userId } = getAuth(req);
  if (!userId) throw new Error("requireClerkAuth must precede this call");
  return userId;
}
