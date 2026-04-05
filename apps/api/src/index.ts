import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { closeDb } from "@qyro/db";

import { requireClerkAuth, validateRetellRequest, validateTwilioSignature } from "./middleware/auth";
import { tenantMiddleware } from "./middleware/tenant";
import leadsRouter from "./routes/leads";
import campaignsRouter from "./routes/campaigns";
import assistRouter, { assistPublicRouter } from "./routes/assist";
import tenantsRouter from "./routes/tenants";
import webhooksRouter from "./routes/webhooks";
import voiceRouter from "./routes/voice";
import retellRouter from "./routes/retell";
import billingRouter, { billingPublicRouter } from "./routes/billing";

const app: Express = express();
const PORT = Number(process.env.PORT ?? 3001);

// ─── Global middleware ────────────────────────────────────────────────────────

// CORS — allow localhost in dev; WEB_ORIGIN / EXTRA_WEB_ORIGIN for prod.
// Set WEB_ORIGIN=https://qyro.us (and www variant) in the production env.
const corsOrigins: string[] = ["http://localhost:3000"];
if (process.env.WEB_ORIGIN) {
  corsOrigins.push(process.env.WEB_ORIGIN);
}
if (process.env.EXTRA_WEB_ORIGIN) {
  corsOrigins.push(process.env.EXTRA_WEB_ORIGIN);
}

function isAllowedOrigin(origin: string): boolean {
  const normalized = origin.trim().toLowerCase();
  if (!normalized) return false;

  if (corsOrigins.some((allowed) => allowed.trim().toLowerCase() === normalized)) {
    return true;
  }

  return normalized === "https://qyro.us" || normalized === "https://www.qyro.us";
}

app.use(cors({
  origin: (origin, callback) => {
    // Non-browser requests (curl, server-to-server) may not send Origin.
    if (!origin) {
      callback(null, true);
      return;
    }

    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("CORS origin not allowed"));
  },
  credentials: true,
}));

// Parse JSON bodies — capture rawBody for HMAC signature verification
app.use(express.json({
  verify: (req, _res, buf) => {
    (req as unknown as Record<string, unknown>).rawBody = buf;
  },
}));

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
      assistPublic: "POST /api/v1/assist/chat | POST /api/v1/assist/missed-call",
      assistAuthed: "GET /api/sessions | GET /api/appointments | GET/POST /api/v1/assist/*",
      tenants: "GET|PATCH /api/v1/tenants/settings",
      billing: "GET|POST /api/v1/billing/*",
      voice: "POST /api/v1/voice/*",
      retell: "POST /api/v1/retell/*",
      webhooks: "POST /webhooks/nightly/ingest | POST /webhooks/morning/digest | POST /webhooks/stripe"
    }
  });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// Webhooks use their own signature verification — not Clerk auth
app.use("/webhooks", webhooksRouter);
app.use("/webhooks", billingPublicRouter);
app.use("/api/v1/voice", validateTwilioSignature, voiceRouter);
app.use("/api/v1/retell", validateRetellRequest, retellRouter);

// Public assist routes (widget chat) — no Clerk auth, validates tenantId from DB
app.use("/api/v1/assist", assistPublicRouter);

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

app.use(
  "/api",
  requireClerkAuth,
  tenantMiddleware,
  billingRouter
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
