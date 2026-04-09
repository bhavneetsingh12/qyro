import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { WebSocketServer } from "ws";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { closeDb } from "@qyro/db";

import { requireClerkAuth, validateRetellRequest, validateSignalWireSignature, validateSwaigRequest } from "./middleware/auth";
import { tenantMiddleware } from "./middleware/tenant";
import { rateLimit } from "./middleware/rateLimit";
import leadsRouter from "./routes/leads";
import campaignsRouter from "./routes/campaigns";
import assistRouter, { assistPublicRouter } from "./routes/assist";
import tenantsRouter from "./routes/tenants";
import webhooksRouter from "./routes/webhooks";
import voiceRouter from "./routes/voice";
import retellRouter, { handleRetellLlmWebSocket } from "./routes/retell";
import eventsRouter from "./routes/events";
import billingRouter, { billingPublicRouter } from "./routes/billing";
import adminRouter from "./routes/admin";
import swaigRouter from "./routes/swaig";

// ─── Required env var validation ─────────────────────────────────────────────
// Fail fast with a clear message rather than a cryptic crash later.

console.log("[api] 1. Starting — validating env vars");

const REQUIRED_ENV_VARS = [
  "DATABASE_URL",
  "REDIS_URL",
  "CLERK_SECRET_KEY",
  "STRIPE_SECRET_KEY",
  "OPENAI_API_KEY",
];

for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    console.error(`[api] STARTUP FAILED — missing required env var: ${key}`);
    process.exit(1);
  }
}

console.log("[api] 2. Env vars OK");

// ─── App setup ────────────────────────────────────────────────────────────────

const app: Express = express();
const PORT = Number(process.env.PORT ?? 3001);

// ─── Health check — registered FIRST so Railway can probe immediately ─────────
// Must be before any middleware or DB calls so it always responds,
// even if Clerk/DB/Redis is not yet initialised.

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// ─── CORS ─────────────────────────────────────────────────────────────────────

const corsOrigins: string[] = ["http://localhost:3000"];
if (process.env.WEB_ORIGIN)       corsOrigins.push(process.env.WEB_ORIGIN);
if (process.env.EXTRA_WEB_ORIGIN) corsOrigins.push(process.env.EXTRA_WEB_ORIGIN);

function isAllowedOrigin(origin: string): boolean {
  const normalized = origin.trim().toLowerCase();
  if (!normalized) return false;
  if (corsOrigins.some((allowed) => allowed.trim().toLowerCase() === normalized)) return true;
  return normalized === "https://qyro.us" || normalized === "https://www.qyro.us";
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) { callback(null, true); return; }
    if (isAllowedOrigin(origin)) { callback(null, true); return; }
    callback(new Error("CORS origin not allowed"));
  },
  credentials: true,
}));

// Parse URL-encoded bodies (SignalWire / Twilio cXML webhooks send this content type).
// Must be registered BEFORE express.json() so that voice webhook requests are parsed
// before validateSignalWireSignature reads req.body for HMAC computation.
app.use(express.urlencoded({ extended: false }));

// Parse JSON bodies — capture rawBody for Retell HMAC-SHA256 signature verification.
app.use(express.json({
  verify: (req, _res, buf) => {
    (req as unknown as Record<string, unknown>).rawBody = buf;
  },
}));

// Clerk session verification on all requests (attaches auth to req).
app.use(clerkMiddleware());

// ─── Root info route ──────────────────────────────────────────────────────────

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
      admin: "GET /api/v1/admin/me | GET /api/v1/admin/tenants",
      billing: "GET|POST /api/v1/billing/*",
      voice: "POST /api/v1/voice/*",
      retell: "POST /api/v1/retell/*",
      webhooks: "POST /webhooks/nightly/ingest | POST /webhooks/morning/digest | POST /webhooks/stripe"
    }
  });
});

// ─── Public routes (no auth) ──────────────────────────────────────────────────

app.use("/webhooks", webhooksRouter);
app.use("/webhooks", billingPublicRouter);
app.use("/api/v1/voice", validateSignalWireSignature, voiceRouter);
app.use("/api/v1/retell", validateRetellRequest, retellRouter);
app.use("/api/v1/swaig", validateSwaigRequest, swaigRouter);
app.use("/api/v1/assist", assistPublicRouter);

// ─── Authenticated + tenant-scoped routes ─────────────────────────────────────

app.use("/api/leads",     requireClerkAuth, tenantMiddleware, rateLimit("general"), leadsRouter);
app.use("/api/campaigns", requireClerkAuth, tenantMiddleware, rateLimit("general"), campaignsRouter);
app.use("/api",           requireClerkAuth, tenantMiddleware, rateLimit("general"), assistRouter);
app.use("/api/v1/tenants",requireClerkAuth, tenantMiddleware, rateLimit("general"), tenantsRouter);
app.use("/api/v1/events", requireClerkAuth, tenantMiddleware, eventsRouter);
app.use("/api",           requireClerkAuth, adminRouter);
app.use("/api",           requireClerkAuth, tenantMiddleware, rateLimit("general"), billingRouter);

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  const status = (err as any).status ?? 500;
  res.status(status).json({
    error: (err as any).code ?? "INTERNAL_ERROR",
    message: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
  });
});

// ─── Catch unhandled errors so crashes always print a useful message ──────────

process.on("uncaughtException", (err) => {
  console.error("[api] UNCAUGHT EXCEPTION:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[api] UNHANDLED REJECTION:", reason);
  process.exit(1);
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  try {
    console.log(`[api] 3. Starting server — PORT=${PORT} NODE_ENV=${process.env.NODE_ENV}`);

    const server = app.listen(PORT, () => {
      console.log(`[api] 4. Listening on http://localhost:${PORT}`);
    });

    // ── Retell Custom LLM WebSocket ─────────────────────────────────────────
    const wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "", `http://localhost`);
      if (url.pathname !== "/api/v1/retell/llm-websocket") {
        socket.destroy();
        return;
      }
      // Validate Retell shared secret sent as Authorization header
      const secret = process.env.RETELL_WEBHOOK_SECRET ?? "";
      const authHeader = String(request.headers.authorization ?? "");
      if (secret && authHeader !== secret) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        handleRetellLlmWebSocket(ws);
      });
    });

    async function shutdown() {
      console.log("[api] SIGTERM received — shutting down gracefully");
      server.close(async () => {
        await closeDb();
        process.exit(0);
      });
    }

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (err) {
    console.error("[api] STARTUP FAILED:", err);
    process.exit(1);
  }
}

start();

export { app };
