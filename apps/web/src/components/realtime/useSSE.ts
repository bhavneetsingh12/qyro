"use client";

import { useEffect, useRef, useState } from "react";

export type SSEMessage = {
  event: string;
  data: unknown;
};

type UseSSEOptions = {
  url: string;
  getToken: () => Promise<string | null>;
  onEvent?: (message: SSEMessage) => void;
  reconnectDelayMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseChunk(chunk: string): SSEMessage | null {
  const lines = chunk.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  if (dataLines.length === 0) return null;

  const dataText = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(dataText) };
  } catch {
    return { event, data: dataText };
  }
}

const SSE_MAX_DELAY_MS = 30_000;

export function useSSE(options: UseSSEOptions): { connected: boolean; lastEventAt: string | null } {
  const { url, getToken, onEvent, reconnectDelayMs = 2000 } = options;
  const onEventRef = useRef(onEvent);
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let stopped = false;
    let controller: AbortController | null = null;

    async function run() {
      let delay = reconnectDelayMs;

      while (!stopped) {
        try {
          const token = await getToken();
          if (!token) {
            setConnected(false);
            await sleep(delay);
            delay = Math.min(delay * 2, SSE_MAX_DELAY_MS);
            continue;
          }

          controller = new AbortController();

          const res = await fetch(url, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "text/event-stream",
            },
            cache: "no-store",
            signal: controller.signal,
          });

          // Auth failures are permanent until the user re-authenticates — stop looping.
          if (res.status === 401 || res.status === 403) {
            setConnected(false);
            stopped = true;
            break;
          }

          if (!res.ok || !res.body) {
            setConnected(false);
            await sleep(delay);
            delay = Math.min(delay * 2, SSE_MAX_DELAY_MS);
            continue;
          }

          // Successful connection — reset backoff.
          delay = reconnectDelayMs;
          setConnected(true);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (!stopped) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            while (true) {
              const splitAt = buffer.indexOf("\n\n");
              if (splitAt < 0) break;

              const chunk = buffer.slice(0, splitAt);
              buffer = buffer.slice(splitAt + 2);

              const parsed = parseChunk(chunk);
              if (!parsed) continue;

              setLastEventAt(new Date().toISOString());
              onEventRef.current?.(parsed);
            }
          }

          setConnected(false);
        } catch {
          setConnected(false);
        }

        if (!stopped) {
          await sleep(delay);
          delay = Math.min(delay * 2, SSE_MAX_DELAY_MS);
        }
      }
    }

    void run();

    return () => {
      stopped = true;
      controller?.abort();
    };
  }, [getToken, reconnectDelayMs, url]);

  return { connected, lastEventAt };
}
