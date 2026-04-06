import { redis } from "./queues";

export const REALTIME_CHANNEL = "qyro:events:v1";

export type RealtimeEventType =
  | "new_lead"
  | "call_status_change"
  | "new_pending_approval"
  | "escalation";

export type RealtimeEvent = {
  type: RealtimeEventType;
  tenantId: string;
  ts: string;
  payload: Record<string, unknown>;
};

export async function publishRealtimeEvent(input: {
  type: RealtimeEventType;
  tenantId: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const event: RealtimeEvent = {
    type: input.type,
    tenantId: input.tenantId,
    ts: new Date().toISOString(),
    payload: input.payload ?? {},
  };

  await redis.publish(REALTIME_CHANNEL, JSON.stringify(event));
}

export async function createRealtimeSubscription(
  onEvent: (event: RealtimeEvent) => void,
): Promise<() => Promise<void>> {
  const subscriber = redis.duplicate();
  await subscriber.subscribe(REALTIME_CHANNEL);

  const onMessage = (_channel: string, message: string) => {
    try {
      const parsed = JSON.parse(message) as RealtimeEvent;
      if (!parsed?.type || !parsed?.tenantId) return;
      onEvent(parsed);
    } catch {
      // Ignore malformed pub/sub payloads.
    }
  };

  subscriber.on("message", onMessage);

  return async () => {
    subscriber.off("message", onMessage);
    try {
      await subscriber.unsubscribe(REALTIME_CHANNEL);
    } finally {
      subscriber.disconnect();
    }
  };
}