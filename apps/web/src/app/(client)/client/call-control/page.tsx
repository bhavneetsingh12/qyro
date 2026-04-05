"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Activity, PauseCircle, PlayCircle, RefreshCw, ShieldAlert, Users } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

type ControlState = {
  enabled: boolean;
  paused: boolean;
  pausedReason: string;
  maxConcurrentCalls: number;
  globalPaused: boolean;
  canManage: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

type MetricsState = {
  totals: {
    queued: number;
    retryScheduled: number;
    active: number;
    completed: number;
    dnd: number;
    blocked: number;
    total: number;
  };
  capacity: {
    maxConcurrentCalls: number;
    active: number;
    availableSlots: number;
  };
  statusCounts: Record<string, number>;
  recent: Array<{
    id: string;
    status: string;
    outcome: string | null;
    attemptCount: number;
    maxAttempts: number;
    nextAttemptAt: string | null;
    createdAt: string;
  }>;
};

const DEFAULT_CONTROL: ControlState = {
  enabled: false,
  paused: false,
  pausedReason: "",
  maxConcurrentCalls: 3,
  globalPaused: false,
  canManage: false,
  updatedAt: null,
  updatedBy: null,
};

const DEFAULT_METRICS: MetricsState = {
  totals: {
    queued: 0,
    retryScheduled: 0,
    active: 0,
    completed: 0,
    dnd: 0,
    blocked: 0,
    total: 0,
  },
  capacity: {
    maxConcurrentCalls: 3,
    active: 0,
    availableSlots: 3,
  },
  statusCounts: {},
  recent: [],
};

async function fetchWithToken<T>(url: string, token: string): Promise<T | null> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return null;
  return res.json() as Promise<T>;
}

export default function ClientCallControlPage() {
  const { getToken } = useAuth();

  const [control, setControl] = useState<ControlState>(DEFAULT_CONTROL);
  const [metrics, setMetrics] = useState<MetricsState>(DEFAULT_METRICS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pausedReasonDraft, setPausedReasonDraft] = useState("");
  const [maxConcurrentDraft, setMaxConcurrentDraft] = useState(3);
  const [drainWhenPause, setDrainWhenPause] = useState(false);
  const [numbersDraft, setNumbersDraft] = useState("");
  const [enqueueMaxAttempts, setEnqueueMaxAttempts] = useState(3);
  const [enqueueResult, setEnqueueResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    const [controlRes, metricsRes] = await Promise.all([
      fetchWithToken<{ data: ControlState }>(`${API_URL}/api/v1/assist/outbound-calls/control`, token),
      fetchWithToken<{ data: MetricsState }>(`${API_URL}/api/v1/assist/outbound-calls/metrics`, token),
    ]);

    if (!controlRes || !metricsRes) {
      setError("Could not load outbound control data.");
      setLoading(false);
      return;
    }

    setControl(controlRes.data);
    setPausedReasonDraft(controlRes.data.pausedReason ?? "");
    setMaxConcurrentDraft(controlRes.data.maxConcurrentCalls ?? 3);
    setMetrics(metricsRes.data);
    setLoading(false);
    setError(null);
  }, [getToken]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      load();
    }, 15000);
    return () => clearInterval(timer);
  }, [load]);

  async function patchControl(payload: {
    enabled?: boolean;
    paused?: boolean;
    pausedReason?: string;
    maxConcurrentCalls?: number;
    drainQueued?: boolean;
  }) {
    const token = await getToken();
    if (!token) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/api/v1/assist/outbound-calls/control`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({ message: "Update failed" }))) as { message?: string };
        throw new Error(body?.message ?? "Update failed");
      }

      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function enqueueOutboundCalls() {
    const token = await getToken();
    if (!token) return;

    const numbers = numbersDraft
      .split(/[\n,;]/g)
      .map((v) => v.trim())
      .filter(Boolean);

    if (numbers.length === 0) {
      setError("Enter at least one phone number to queue outbound calls.");
      return;
    }

    setSaving(true);
    setError(null);
    setEnqueueResult(null);

    try {
      const res = await fetch(`${API_URL}/api/v1/assist/outbound-calls/enqueue`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          numbers,
          maxAttempts: enqueueMaxAttempts,
        }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        data?: { enqueued?: number };
      };

      if (!res.ok) {
        throw new Error(body.message ?? body.error ?? "Failed to enqueue outbound calls");
      }

      const enqueued = Number(body.data?.enqueued ?? 0);
      setEnqueueResult(`${enqueued} outbound call${enqueued === 1 ? "" : "s"} queued.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enqueue outbound calls");
    } finally {
      setSaving(false);
    }
  }

  const statCards = useMemo(() => ([
    { label: "Queued", value: metrics.totals.queued, tone: "bg-amber-50 text-amber-700" },
    { label: "Retry Scheduled", value: metrics.totals.retryScheduled, tone: "bg-blue-50 text-blue-700" },
    { label: "Active", value: metrics.totals.active, tone: "bg-teal-50 text-teal-700" },
    { label: "Completed", value: metrics.totals.completed, tone: "bg-emerald-50 text-emerald-700" },
    { label: "DND", value: metrics.totals.dnd, tone: "bg-rose-50 text-rose-700" },
    { label: "Compliance Blocked", value: metrics.totals.blocked, tone: "bg-stone-100 text-stone-700" },
  ]), [metrics]);

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Call Control Center</h1>
          <p className="text-sm text-stone-400 mt-0.5">Outbound pipeline controls, live counters, and queue safety toggles.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#E8E6E1] bg-white text-sm text-stone-700 hover:bg-stone-50"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {(control.globalPaused || !control.enabled) && (
        <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <ShieldAlert size={16} className="text-rose-600 shrink-0 mt-0.5" />
          <div className="text-sm text-rose-700">
            <p className="font-medium">
              {control.globalPaused
                ? "Global outbound pause is active. No tenant can dial."
                : "Outbound voice compliance is disabled for this tenant."}
            </p>
            <p className="mt-0.5">Re-enable before launching outbound campaigns.</p>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-4 text-sm text-rose-600">{error}</p>
      )}

      <div className="mt-6 grid grid-cols-2 lg:grid-cols-6 gap-3">
        {statCards.map((card) => (
          <div key={card.label} className="rounded-[12px] border border-[#E8E6E1] bg-white p-4">
            <p className="text-xs text-stone-500">{card.label}</p>
            <p className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-sm font-semibold ${card.tone}`}>
              {card.value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-[12px] border border-[#E8E6E1] bg-white px-4 py-3 text-sm text-stone-700">
        Capacity: {metrics.capacity.active}/{metrics.capacity.maxConcurrentCalls} active calls, {metrics.capacity.availableSlots} slots available
      </div>

      <div className="mt-6 grid lg:grid-cols-[1.1fr_1fr] gap-5">
        <section className="rounded-[14px] border border-[#E8E6E1] bg-white p-5">
          <h2 className="text-sm font-semibold text-stone-800">Queue Outbound Calls</h2>
          <p className="mt-1 text-xs text-stone-500">Enter one or more phone numbers to create manual outbound attempts.</p>

          <div className="mt-4 space-y-3">
            <label className="block text-sm text-stone-700">Phone numbers</label>
            <textarea
              value={numbersDraft}
              onChange={(e) => setNumbersDraft((e.target as HTMLTextAreaElement).value)}
              placeholder="+15035551234, +12065550123"
              className="input min-h-[92px]"
              disabled={saving}
            />

            <label className="block text-sm text-stone-700">Max attempts per number</label>
            <input
              type="number"
              min={1}
              max={8}
              value={enqueueMaxAttempts}
              onChange={(e) => setEnqueueMaxAttempts(Math.max(1, Math.min(8, Number((e.target as HTMLInputElement).value) || 1)))}
              className="input w-28"
              disabled={saving}
            />
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={enqueueOutboundCalls}
              disabled={saving || !control.enabled || control.globalPaused}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium disabled:opacity-50"
            >
              Queue Calls
            </button>
            {enqueueResult && <span className="text-xs text-teal-700">{enqueueResult}</span>}
          </div>

          <div className="mt-5 h-px bg-[#F0EEE9]" />

          <h2 className="text-sm font-semibold text-stone-800">Control Plane</h2>
          <p className="mt-1 text-xs text-stone-500">Pause/resume tenant outbound, set max concurrent capacity, and optionally drain queued jobs.</p>

          <div className="mt-4 space-y-3">
            <label className="block text-sm text-stone-700">Pause reason</label>
            <input
              value={pausedReasonDraft}
              onChange={(e) => setPausedReasonDraft((e.target as HTMLInputElement).value)}
              placeholder="Example: compliance review or agent capacity issue"
              className="input"
              disabled={!control.canManage}
            />

            <label className="block text-sm text-stone-700">Max concurrent calls</label>
            <div className="flex items-center gap-2">
              <Users size={14} className="text-stone-400" />
              <input
                type="number"
                min={1}
                max={25}
                value={maxConcurrentDraft}
                onChange={(e) => setMaxConcurrentDraft(Math.max(1, Math.min(25, Number((e.target as HTMLInputElement).value) || 1)))}
                className="input w-28"
                disabled={!control.canManage}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={drainWhenPause}
                onChange={(e) => setDrainWhenPause((e.target as HTMLInputElement).checked)}
                disabled={!control.canManage}
              />
              Drain queued + retry-scheduled calls when pausing
            </label>
          </div>

          <div className="mt-5 flex gap-2 flex-wrap">
            <button
              onClick={() => patchControl({ enabled: true })}
              disabled={!control.canManage || saving || control.globalPaused || control.enabled}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"
            >
              Enable Outbound
            </button>
            <button
              onClick={() => patchControl({ enabled: false, paused: true, pausedReason: pausedReasonDraft || "disabled by user" })}
              disabled={!control.canManage || saving || !control.enabled}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-stone-700 text-white text-sm font-medium disabled:opacity-50"
            >
              Disable Outbound
            </button>
            <button
              onClick={() => patchControl({
                paused: true,
                pausedReason: pausedReasonDraft,
                maxConcurrentCalls: maxConcurrentDraft,
                drainQueued: drainWhenPause,
              })}
              disabled={!control.canManage || saving || control.globalPaused}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-600 text-white text-sm font-medium disabled:opacity-50"
            >
              <PauseCircle size={14} />
              Pause Outbound
            </button>
            <button
              onClick={() => patchControl({
                paused: false,
                pausedReason: pausedReasonDraft,
                maxConcurrentCalls: maxConcurrentDraft,
              })}
              disabled={!control.canManage || saving || control.globalPaused}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium disabled:opacity-50"
            >
              <PlayCircle size={14} />
              Resume Outbound
            </button>
            <button
              onClick={() => patchControl({ maxConcurrentCalls: maxConcurrentDraft, pausedReason: pausedReasonDraft })}
              disabled={!control.canManage || saving}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#E8E6E1] bg-white text-sm font-medium text-stone-700 disabled:opacity-50"
            >
              <Activity size={14} />
              Save Capacity
            </button>
          </div>

          <div className="mt-4 text-xs text-stone-500">
            <p>Status: {control.paused ? "Paused" : "Running"}</p>
            <p>Last update: {control.updatedAt ? new Date(control.updatedAt).toLocaleString() : "-"}</p>
          </div>
        </section>

        <section className="rounded-[14px] border border-[#E8E6E1] bg-white p-5">
          <h2 className="text-sm font-semibold text-stone-800">Recent Outbound Attempts</h2>
          <p className="mt-1 text-xs text-stone-500">Latest 30 attempts with retry posture and queue timing.</p>

          <div className="mt-4 max-h-[370px] overflow-y-auto rounded-lg border border-[#F0EEE9]">
            {loading ? (
              <p className="px-4 py-4 text-sm text-stone-500">Loading...</p>
            ) : metrics.recent.length === 0 ? (
              <p className="px-4 py-4 text-sm text-stone-500">No outbound attempts yet.</p>
            ) : (
              <ul className="divide-y divide-[#F0EEE9]">
                {metrics.recent.map((row) => (
                  <li key={row.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-stone-700">{row.status}</span>
                      <span className="text-xs text-stone-400">{new Date(row.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-stone-500 mt-1">Outcome: {row.outcome ?? "-"}</p>
                    <p className="text-xs text-stone-500">Attempts: {row.attemptCount}/{row.maxAttempts}</p>
                    <p className="text-xs text-stone-500">Next attempt: {row.nextAttemptAt ? new Date(row.nextAttemptAt).toLocaleString() : "-"}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
