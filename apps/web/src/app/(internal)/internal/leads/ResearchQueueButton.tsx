"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

type Props = {
  leadId: string;
  idleLabel: string;
  className?: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3005";

export default function ResearchQueueButton({ leadId, idleLabel, className }: Props) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setQueued(false);
    setError(null);

    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/api/leads/${leadId}/research`, {
        method: "POST",
        headers,
        credentials: "include",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { message?: string }));
        throw new Error(body?.message ?? "Failed to queue research");
      }

      setQueued(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue research");
    } finally {
      setPending(false);
      setTimeout(() => setQueued(false), 1200);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1 items-start">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={
          className ??
          "text-xs font-medium px-3 py-1.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 transition-colors disabled:opacity-60"
        }
      >
        {pending ? "Queuing..." : queued ? "Queued" : idleLabel}
      </button>
      {(pending || queued) && (
        <div className={`h-0.5 w-full rounded ${pending ? "bg-amber-300 animate-pulse" : "bg-emerald-300"}`} />
      )}
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}
