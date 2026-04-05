"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { Phone, RefreshCw, Ban, Clock, CheckCircle2, AlertCircle, Loader2, Voicemail } from "lucide-react";
import clsx from "clsx";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type CallAttempt = {
  id: string;
  prospectId: string | null;
  phone: string | null;
  businessName: string | null;
  status: string;
  outcome: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  twilioCallSid: string | null;
  dndAt: string | null;
  createdAt: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
  queued:    { label: "Queued",    color: "text-amber-600 bg-amber-50 border-amber-200",  Icon: Clock },
  dialing:   { label: "Dialing",   color: "text-blue-600 bg-blue-50 border-blue-200",    Icon: Phone },
  ringing:   { label: "Ringing",   color: "text-blue-600 bg-blue-50 border-blue-200",    Icon: Phone },
  completed: { label: "Completed", color: "text-green-600 bg-green-50 border-green-200", Icon: CheckCircle2 },
  failed:    { label: "Failed",    color: "text-red-600 bg-red-50 border-red-200",        Icon: AlertCircle },
  dnd:       { label: "DND",       color: "text-stone-500 bg-stone-100 border-stone-200", Icon: Ban },
  voicemail: { label: "Voicemail", color: "text-purple-600 bg-purple-50 border-purple-200", Icon: Voicemail },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "text-stone-500 bg-stone-100 border-stone-200", Icon: Clock };
  const { Icon, label, color } = cfg;
  return (
    <span className={clsx("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border", color)}>
      <Icon size={11} strokeWidth={2} />
      {label}
    </span>
  );
}

function fmt(ts: string | null) {
  if (!ts) return "–";
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function OutboundPipelinePage() {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<CallAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/assist/outbound-calls/pipeline?limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setRows(body.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load pipeline");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getToken]);

  useEffect(() => {
    load();
    const iv = setInterval(() => load(true), 20_000);
    return () => clearInterval(iv);
  }, [load]);

  async function cancelAttempt(attemptId: string) {
    setCancellingId(attemptId);
    try {
      const token = await getToken();
      await fetch(`${API_URL}/api/v1/assist/outbound-calls/attempt/${attemptId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await load(true);
    } finally {
      setCancellingId(null);
    }
  }

  const active  = rows.filter(r => ["queued", "dialing", "ringing"].includes(r.status));
  const done    = rows.filter(r => !["queued", "dialing", "ringing"].includes(r.status));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">Outbound Pipeline</h1>
          <p className="text-sm text-stone-500 mt-1">
            Leads queued from QYRO Lead and their call status.
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-stone-400">
          <Loader2 size={24} className="animate-spin mr-3" />
          Loading pipeline…
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="rounded-2xl border border-stone-200 bg-white p-12 text-center">
          <Phone size={36} className="mx-auto text-stone-300 mb-3" strokeWidth={1.5} />
          <p className="text-stone-600 font-medium">No outbound calls yet</p>
          <p className="text-stone-400 text-sm mt-1">
            Select leads in QYRO Lead and click &ldquo;Queue Calls Selected&rdquo; to add them here.
          </p>
        </div>
      )}

      {/* Active calls table */}
      {!loading && active.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-stone-700 mb-3 uppercase tracking-wide">
            Active · {active.length}
          </h2>
          <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-xs text-stone-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Business</th>
                  <th className="text-left px-4 py-3 font-medium">Phone</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Attempts</th>
                  <th className="text-left px-4 py-3 font-medium">Next attempt</th>
                  <th className="text-left px-4 py-3 font-medium">Queued</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {active.map(row => (
                  <tr key={row.id} className="hover:bg-stone-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-stone-900 max-w-[200px] truncate">
                      {row.businessName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-stone-600 font-mono">{row.phone ?? "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    <td className="px-4 py-3 text-stone-600">{row.attemptCount} / {row.maxAttempts}</td>
                    <td className="px-4 py-3 text-stone-500">{fmt(row.nextAttemptAt)}</td>
                    <td className="px-4 py-3 text-stone-400">{fmt(row.createdAt)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => cancelAttempt(row.id)}
                        disabled={cancellingId === row.id}
                        className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50 px-2 py-1 rounded border border-red-200 hover:bg-red-50 transition-colors"
                      >
                        {cancellingId === row.id ? "…" : "Cancel"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Completed / past calls table */}
      {!loading && done.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-stone-700 mb-3 uppercase tracking-wide">
            History · {done.length}
          </h2>
          <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-xs text-stone-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Business</th>
                  <th className="text-left px-4 py-3 font-medium">Phone</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Outcome</th>
                  <th className="text-left px-4 py-3 font-medium">Attempts</th>
                  <th className="text-left px-4 py-3 font-medium">Last attempt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {done.map(row => (
                  <tr key={row.id} className="hover:bg-stone-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-stone-900 max-w-[200px] truncate">
                      {row.businessName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-stone-600 font-mono">{row.phone ?? "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    <td className="px-4 py-3 text-stone-500 capitalize">{row.outcome ?? "—"}</td>
                    <td className="px-4 py-3 text-stone-600">{row.attemptCount} / {row.maxAttempts}</td>
                    <td className="px-4 py-3 text-stone-400">{fmt(row.lastAttemptAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
