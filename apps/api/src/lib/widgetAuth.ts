import { createHmac, timingSafeEqual } from "node:crypto";

type WidgetTokenPayload = {
  tenantId: string;
  version: number;
  allowedOrigins: string[];
  issuedAt: number;
  expiresAt: number;
};

const DEFAULT_WIDGET_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 180;

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getWidgetSigningSecret(): string | null {
  const explicit = String(process.env.WIDGET_SIGNING_SECRET ?? "").trim();
  if (explicit) return explicit;

  const fallback = String(process.env.TENANT_INTEGRATION_SECRET_KEY ?? "").trim();
  if (fallback) return fallback;

  return null;
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload, "utf8").digest("base64url");
}

function parseAllowedOrigins(metaRaw: unknown): string[] {
  const meta = metaRaw && typeof metaRaw === "object" ? metaRaw as Record<string, unknown> : {};
  const raw = meta.widget_allowed_origins ?? meta.widgetAllowedOrigins;
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw.split(",").map((value) => value.trim()).filter(Boolean);
  }
  return [];
}

function normalizeOrigins(origins: string[]): string[] {
  return origins
    .map((value) => value.trim().replace(/\/$/, "").toLowerCase())
    .filter(Boolean)
    .sort();
}

export function getWidgetTokenVersion(metaRaw: unknown): number {
  const meta = metaRaw && typeof metaRaw === "object" ? metaRaw as Record<string, unknown> : {};
  const value = Number(meta.widget_token_version ?? 1);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.trunc(value));
}

export function issueWidgetToken(params: {
  tenantId: string;
  metadata: unknown;
  ttlSeconds?: number;
}): { token: string; expiresAt: string; version: number } {
  const secret = getWidgetSigningSecret();
  if (!secret) {
    throw new Error("WIDGET_SIGNING_SECRET or TENANT_INTEGRATION_SECRET_KEY is required to issue widget tokens");
  }

  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.max(60, Math.min(params.ttlSeconds ?? DEFAULT_WIDGET_TOKEN_TTL_SECONDS, 60 * 60 * 24 * 365));
  const payload: WidgetTokenPayload = {
    tenantId: params.tenantId,
    version: getWidgetTokenVersion(params.metadata),
    allowedOrigins: normalizeOrigins(parseAllowedOrigins(params.metadata)),
    issuedAt: now,
    expiresAt: now + ttlSeconds,
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, secret);

  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
    version: payload.version,
  };
}

export function verifyWidgetToken(params: {
  token: string;
  tenantId: string;
  metadata: unknown;
}): { ok: true } | { ok: false; message: string } {
  const secret = getWidgetSigningSecret();
  if (!secret) {
    return { ok: false, message: "Widget token verification is not configured" };
  }

  const [encodedPayload, providedSignature] = params.token.split(".");
  if (!encodedPayload || !providedSignature) {
    return { ok: false, message: "Invalid widget token format" };
  }

  let expectedSignature: string;
  try {
    expectedSignature = signPayload(encodedPayload, secret);
    const providedBuffer = Buffer.from(providedSignature, "base64url");
    const expectedBuffer = Buffer.from(expectedSignature, "base64url");
    if (
      providedBuffer.length !== expectedBuffer.length
      || !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      return { ok: false, message: "Invalid widget token signature" };
    }
  } catch {
    return { ok: false, message: "Invalid widget token signature" };
  }

  let payload: WidgetTokenPayload;
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload)) as WidgetTokenPayload;
  } catch {
    return { ok: false, message: "Invalid widget token payload" };
  }

  if (!payload || payload.tenantId !== params.tenantId) {
    return { ok: false, message: "Widget token tenant mismatch" };
  }

  if (payload.expiresAt <= Math.floor(Date.now() / 1000)) {
    return { ok: false, message: "Widget token expired" };
  }

  const currentVersion = getWidgetTokenVersion(params.metadata);
  if (payload.version !== currentVersion) {
    return { ok: false, message: "Widget token has been rotated" };
  }

  const currentOrigins = normalizeOrigins(parseAllowedOrigins(params.metadata));
  const tokenOrigins = normalizeOrigins(Array.isArray(payload.allowedOrigins) ? payload.allowedOrigins : []);
  if (currentOrigins.join("|") !== tokenOrigins.join("|")) {
    return { ok: false, message: "Widget token no longer matches the configured origins" };
  }

  return { ok: true };
}
