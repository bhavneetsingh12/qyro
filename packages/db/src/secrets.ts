import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const SECRET_PREFIX = "enc:v1";
const ALGORITHM = "aes-256-gcm";

function getDerivedKey(): Buffer | null {
  const raw = String(process.env.TENANT_INTEGRATION_SECRET_KEY ?? "").trim();
  if (!raw) return null;
  return createHash("sha256").update(raw, "utf8").digest();
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return String(value ?? "").startsWith(`${SECRET_PREFIX}:`);
}

export function encryptSecret(value: string): string {
  const normalized = value.trim();
  if (!normalized) return normalized;

  const key = getDerivedKey();
  if (!key) {
    throw new Error("TENANT_INTEGRATION_SECRET_KEY is required to encrypt tenant integration secrets");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    SECRET_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptSecret(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (!isEncryptedSecret(normalized)) return normalized;

  const key = getDerivedKey();
  if (!key) {
    throw new Error("TENANT_INTEGRATION_SECRET_KEY is required to decrypt tenant integration secrets");
  }

  const parts = normalized.split(":");
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== SECRET_PREFIX) {
    throw new Error("Invalid encrypted tenant integration secret format");
  }

  const iv = Buffer.from(parts[2], "base64url");
  const tag = Buffer.from(parts[3], "base64url");
  const encrypted = Buffer.from(parts[4], "base64url");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
