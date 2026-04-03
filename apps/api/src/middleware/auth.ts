import { requireAuth, getAuth } from "@clerk/express";
import type { RequestHandler } from "express";

// Applies Clerk session verification. Rejects 401 if no valid session.
// Must come after clerkMiddleware() applied in index.ts.
const clerkRequireAuth = requireAuth();

export const requireClerkAuth: RequestHandler = (req, res, next) => {
  if (process.env.DEV_BYPASS_AUTH === "true") {
    next();
    return;
  }
  clerkRequireAuth(req, res, next);
};

// Extracts Clerk userId from the verified session. Safe to call after requireClerkAuth.
export function getClerkUserId(req: Parameters<RequestHandler>[0]): string {
  const { userId } = getAuth(req);
  if (!userId) throw new Error("requireClerkAuth must precede this call");
  return userId;
}
