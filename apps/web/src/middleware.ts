import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/assist(.*)",
  "/lead(.*)",
  "/contact(.*)",
  "/terms",
  "/privacy",
  "/api/waitlist(.*)",
]);

// ─── Rate limiter for ops route (in-memory, best-effort) ─────────────────────
// Resets on cold start; primary gate is Clerk auth + obscured path.
const opsRateMap = new Map<string, { count: number; windowStart: number; blockedUntil: number }>();

function isOpsRateLimited(ip: string): boolean {
  const now = Date.now();
  const WINDOW_MS = 60_000;     // 1 minute window
  const MAX_REQUESTS = 5;
  const BLOCK_MS = 3_600_000;   // 1 hour block

  const entry = opsRateMap.get(ip);

  if (entry && entry.blockedUntil > 0 && now < entry.blockedUntil) {
    return true; // still within block period
  }

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    opsRateMap.set(ip, { count: 1, windowStart: now, blockedUntil: 0 });
    return false;
  }

  entry.count += 1;
  if (entry.count > MAX_REQUESTS) {
    entry.blockedUntil = now + BLOCK_MS;
    opsRateMap.set(ip, entry);
    return true;
  }

  opsRateMap.set(ip, entry);
  return false;
}

export default clerkMiddleware(async (auth, req) => {
  const bypassAuthInDev =
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_BYPASS_AUTH === "true";

  if (bypassAuthInDev) {
    return;
  }

  // Rate-limit requests to the ops route
  if (req.nextUrl.pathname.startsWith("/qx-ops")) {
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(",")[0]?.trim() : (req.headers.get("x-real-ip") ?? "unknown");
    if (isOpsRateLimited(ip ?? "unknown")) {
      return new NextResponse(null, { status: 404 });
    }
  }

  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
