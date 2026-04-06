"use client";

import { useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useSSE, type SSEMessage } from "./useSSE";

type Toast = {
  id: string;
  title: string;
  body: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

function buildToast(message: SSEMessage): Toast | null {
  const payload = (message.data ?? {}) as Record<string, unknown>;

  if (message.event === "new_pending_approval") {
    const customer = String(payload.customer ?? "A customer");
    return {
      id: `${Date.now()}-${Math.random()}`,
      title: "New Pending Approval",
      body: `${customer} has a message waiting for review.`,
    };
  }

  if (message.event === "escalation") {
    const customer = String(payload.customer ?? "A customer");
    const reason = String(payload.reason ?? "escalation requested");
    return {
      id: `${Date.now()}-${Math.random()}`,
      title: "Escalation Triggered",
      body: `${customer}: ${reason}`,
    };
  }

  return null;
}

export default function LiveDashboardClient({
  showToasts = false,
}: {
  showToasts?: boolean;
}) {
  const router = useRouter();
  const { getToken } = useAuth();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const streamUrl = useMemo(() => `${API_URL}/api/v1/events/stream`, []);

  const { connected } = useSSE({
    url: streamUrl,
    getToken,
    onEvent: (message) => {
      if (["new_lead", "call_status_change", "new_pending_approval", "escalation"].includes(message.event)) {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => router.refresh(), 250);
      }

      if (showToasts) {
        const toast = buildToast(message);
        if (toast) {
          setToasts((prev) => [...prev, toast].slice(-4));
          setTimeout(() => {
            setToasts((prev) => prev.filter((item) => item.id !== toast.id));
          }, 5000);
        }
      }
    },
  });

  return (
    <>
      <div className="flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-stone-300"}`}
          aria-hidden="true"
        />
        <span className="text-xs text-stone-500">Live updates</span>
      </div>

      {showToasts && toasts.length > 0 && (
        <div className="fixed right-4 top-4 z-50 flex w-[320px] flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="rounded-lg border border-stone-200 bg-white px-3 py-2 shadow-md"
              role="status"
            >
              <p className="text-sm font-semibold text-stone-800">{toast.title}</p>
              <p className="mt-0.5 text-xs text-stone-600">{toast.body}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
