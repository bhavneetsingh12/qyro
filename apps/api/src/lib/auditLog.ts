// Audit logging helper — fire-and-forget DB writes for data access events.
// Call from route handlers for reads of leads, calls, transcripts, and exports.

import { db } from "@qyro/db";
import { auditLogs } from "@qyro/db";
import type { Request } from "express";

function getRequestIp(req: Request): string {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
  return forwarded || req.ip || "unknown";
}

export interface AuditParams {
  req:                 Request;
  tenantId:            string;
  userId?:             string | null;
  action:              string;      // e.g. "leads.list", "calls.export", "transcripts.read"
  resourceType?:       string;
  resourceId?:         string;
  responseRecordCount?: number;
}

/**
 * Write an audit log entry. Fire-and-forget — never throws.
 */
export function logAudit(params: AuditParams): void {
  const { req, tenantId, userId, action, resourceType, resourceId, responseRecordCount } = params;

  db.insert(auditLogs)
    .values({
      tenantId,
      userId:               userId ?? null,
      action,
      resourceType:         resourceType ?? null,
      resourceId:           resourceId ?? null,
      endpoint:             req.originalUrl ?? req.path,
      userAgent:            String(req.headers["user-agent"] ?? "").slice(0, 512),
      ipAddress:            getRequestIp(req),
      responseRecordCount:  responseRecordCount ?? null,
    })
    .then(() => {/* no-op */})
    .catch((err) => {
      console.warn("[auditLog] failed to write audit log:", err?.message);
    });
}
