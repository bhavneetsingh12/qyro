"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

type PendingMessage = {
  id: string;
  channel: string;
  messageText: string | null;
  status: string;
  createdAt: string;
};

export default function ClientApprovalsPage() {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<PendingMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const token = await getToken();
    if (!token) return;
    const res = await fetch(`${API_URL}/api/v1/assist/pending`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: PendingMessage[] };
      setRows(json.data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  async function act(messageId: string, action: "approve" | "reject") {
    const token = await getToken();
    if (!token) return;
    setBusyId(messageId);
    const res = await fetch(`${API_URL}/api/v1/assist/${action}/${messageId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    setBusyId(null);
    if (res.ok) {
      setRows((prev) => prev.filter((r) => r.id !== messageId));
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-xl font-semibold text-stone-900">Approvals</h1>
      <p className="text-sm text-stone-400 mt-0.5">Pending assistant messages</p>

      {loading ? (
        <div className="mt-6 text-sm text-stone-500">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-[14px] border border-[#E8E6E1] bg-white px-5 py-10 text-center shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
          <p className="text-sm font-medium text-stone-700">No pending messages</p>
          <p className="mt-1 text-sm text-stone-500">
            Assistant replies that require human approval will appear here before they are sent.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="bg-white border border-[#E8E6E1] rounded-[12px] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-stone-500 uppercase tracking-wide">{row.channel}</p>
                  <p className="text-sm text-stone-800 mt-1 whitespace-pre-wrap">{row.messageText || "(empty)"}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    disabled={busyId === row.id}
                    onClick={() => act(row.id, "approve")}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busyId === row.id}
                    onClick={() => act(row.id, "reject")}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-medium"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
