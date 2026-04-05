"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

type CallRow = {
  id: string;
  callSid: string | null;
  duration: number | null;
  outcome: string | null;
  transcriptUrl: string | null;
  createdAt: string;
};

export default function ClientCallsPage() {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [outcome, setOutcome] = useState<string>("");

  async function load(selectedOutcome = outcome) {
    const token = await getToken();
    if (!token) return;
    const qp = selectedOutcome ? `?outcome=${encodeURIComponent(selectedOutcome)}` : "";
    const res = await fetch(`${API_URL}/api/v1/assist/calls${qp}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      setRows(json.data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Calls</h1>
          <p className="text-sm text-stone-400 mt-0.5">Call logs and transcript links</p>
        </div>
        <div>
          <label className="text-xs text-stone-500 block mb-1">Filter by outcome</label>
          <select
            value={outcome}
            onChange={(e) => {
              const v = e.target.value;
              setOutcome(v);
              setLoading(true);
              load(v);
            }}
            className="input"
          >
            <option value="">All</option>
            <option value="completed">completed</option>
            <option value="in_progress">in_progress</option>
            <option value="no-answer">no-answer</option>
            <option value="busy">busy</option>
            <option value="failed">failed</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 text-sm text-stone-500">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="mt-6 text-sm text-stone-500">No call logs found.</div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-[12px] border border-[#E8E6E1] bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Outcome</th>
                <th className="text-left px-4 py-3 font-medium">Duration</th>
                <th className="text-left px-4 py-3 font-medium">Transcript</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[#F0EFEA]">
                  <td className="px-4 py-3 text-stone-700">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-stone-700">{row.outcome || "-"}</td>
                  <td className="px-4 py-3 text-stone-700">{row.duration ?? 0}s</td>
                  <td className="px-4 py-3">
                    {row.transcriptUrl ? (
                      <a href={row.transcriptUrl} className="text-amber-700 hover:underline" target="_blank" rel="noreferrer">
                        View transcript
                      </a>
                    ) : (
                      <span className="text-stone-400">Unavailable</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
