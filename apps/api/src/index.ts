import express, { type Request, type Response, type NextFunction } from "express";
import { clerkMiddleware } from "@clerk/express";
import { closeDb } from "@qyro/db";

import { requireClerkAuth } from "./middleware/auth";
import { tenantMiddleware } from "./middleware/tenant";
import leadsRouter from "./routes/leads";
import campaignsRouter from "./routes/campaigns";
import webhooksRouter from "./routes/webhooks";

const app = express();
const PORT = process.env.PORT ?? 3001;

// ─── Global middleware ────────────────────────────────────────────────────────

// Parse JSON bodies
app.use(express.json());

// Clerk session verification on all requests (attaches auth to req).
// Does not reject unauthenticated requests — that's done per-route.
app.use(clerkMiddleware());

// ─── Public routes (no auth) ──────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// Webhooks use their own signature verification — not Clerk auth
app.use("/webhooks", webhooksRouter);

// ─── Authenticated + tenant-scoped routes ─────────────────────────────────────
// requireClerkAuth rejects 401 if no valid Clerk session.
// tenantMiddleware resolves tenantId, sets RLS context, adds req.tenantId etc.

app.use(
  "/api/leads",
  requireClerkAuth,
  tenantMiddleware,
  leadsRouter
);

app.use(
  "/api/campaigns",
  requireClerkAuth,
  tenantMiddleware,
  campaignsRouter
);

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  const status = (err as any).status ?? 500;
  res.status(status).json({
    error: (err as any).code ?? "INTERNAL_ERROR",
    message: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});

// Graceful shutdown: close DB connections before exiting
async function shutdown() {
  console.log("[api] shutting down...");
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { app };
