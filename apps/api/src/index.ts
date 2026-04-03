import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { closeDb } from "@qyro/db";

import { requireClerkAuth } from "./middleware/auth";
import { tenantMiddleware } from "./middleware/tenant";
import leadsRouter from "./routes/leads";
import campaignsRouter from "./routes/campaigns";
import assistRouter from "./routes/assist";
import tenantsRouter from "./routes/tenants";
import webhooksRouter from "./routes/webhooks";

const app: Express = express();
const PORT = Number(process.env.PORT ?? 3005);

// ─── Global middleware ────────────────────────────────────────────────────────

// CORS for development (default web origin localhost:3000).
// EXTRA_WEB_ORIGIN can be used when testing from an additional local host/port.
const corsOrigins = ["http://localhost:3000"];
if (process.env.EXTRA_WEB_ORIGIN) {
  corsOrigins.push(process.env.EXTRA_WEB_ORIGIN);
}

app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));

// Parse JSON bodies
app.use(express.json());

// Clerk session verification on all requests (attaches auth to req).
// Does not reject unauthenticated requests — that's done per-route.
app.use(clerkMiddleware());

// ─── Public routes (no auth) ──────────────────────────────────────────────────

app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "Qyro API",
    version: "0.0.1",
    status: "running",
    endpoints: {
      health: "GET /health",
      leads: "GET|POST /api/leads",
      campaigns: "GET|POST /api/campaigns",
      assist: "POST /api/assist",
      tenants: "GET /api/v1/tenants",
      webhooks: "POST /webhooks"
    }
  });
});

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

app.use(
  "/api",
  requireClerkAuth,
  tenantMiddleware,
  assistRouter
);

app.use(
  "/api/v1/tenants",
  requireClerkAuth,
  tenantMiddleware,
  tenantsRouter
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

console.log(`[api] Starting server on port ${PORT}...`);
console.log(`[api] NODE_ENV: ${process.env.NODE_ENV}`);

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
