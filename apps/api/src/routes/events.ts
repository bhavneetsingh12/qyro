import { Router, type Request, type Response, type NextFunction, type Router as ExpressRouter } from "express";
import { createRealtimeSubscription, type RealtimeEvent } from "@qyro/queue";

const router: ExpressRouter = Router();

router.get("/stream", async (req: Request, res: Response, next: NextFunction) => {
  let unsubscribe: (() => Promise<void>) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  try {
    const tenantId = req.tenantId;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const writeEvent = (evt: RealtimeEvent) => {
      if (evt.tenantId !== tenantId) return;
      res.write(`event: ${evt.type}\n`);
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    };

    unsubscribe = await createRealtimeSubscription(writeEvent);

    // Initial handshake event so client can mark stream as connected.
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ ok: true, tenantId, ts: new Date().toISOString() })}\n\n`);

    // Heartbeat prevents idle timeout on proxies/load balancers.
    heartbeat = setInterval(() => {
      res.write(`: ping ${Date.now()}\n\n`);
    }, 30_000);

    req.on("close", async () => {
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribe) await unsubscribe();
    });
  } catch (err) {
    if (heartbeat) clearInterval(heartbeat);
    if (unsubscribe) await unsubscribe();
    next(err);
  }
});

export default router;