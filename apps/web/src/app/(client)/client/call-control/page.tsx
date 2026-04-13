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

type ComplianceDecisionRow = {
  id: string;
  decision: "ALLOW" | "BLOCK" | "MANUAL_REVIEW";
  ruleCode: string;
  explanation: string;
  channel: string;
  automated: boolean;
  evaluatedAt: string;
  prospectId: string | null;
  businessName: string | null;
  phone: string | null;
  email: string | null;
  domain: string | null;
};

type ComplianceReport = {
  days: number;
  totals: Array<{ decision: string; count: number }>;
  byRule: Array<{ ruleCode: string; decision: string; count: number }>;
  byDay: Array<{ day: string; decision: string; count: number }>;
};

type ComplianceAlerts = {
  today: { blocked: number; manualReview: number };
  baselineDailyAvg: { blocked: number; manualReview: number };
  alerts: Array<{ code: string; level: "info" | "warning"; message: string }>;
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

function formatOutcome(outcome: string | null): string {
  if (!outcome) return "No outcome yet";
  const labels: Record<string, string> = {
    missing_prospect_phone: "Lead has no phone number",
    missing_voice_number: "Assist voice number is not configured",
    outside_calling_hours: "Waiting for local calling hours",
    capacity_throttled: "Waiting for available dialing capacity",
    paused_tenant: "Paused for this tenant",
    paused_global: "Paused globally",
    dial_failed_retry: "Dial failed, retry scheduled",
    dial_failed: "Dial failed",
    do_not_contact: "Do not contact",
    blocked_compliance: "Blocked by compliance gate",
  };
  return labels[outcome] ?? outcome.replace(/_/g, " ");
}

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
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pausedReasonDraft, setPausedReasonDraft] = useState("");
  const [maxConcurrentDraft, setMaxConcurrentDraft] = useState(3);
  const [drainWhenPause, setDrainWhenPause] = useState(false);
  const [numbersDraft, setNumbersDraft] = useState("");
  const [enqueueMaxAttempts, setEnqueueMaxAttempts] = useState(3);
  const [enqueueResult, setEnqueueResult] = useState<string | null>(null);
  const [complianceRows, setComplianceRows] = useState<ComplianceDecisionRow[]>([]);
  const [complianceReport, setComplianceReport] = useState<ComplianceReport | null>(null);
  const [complianceAlerts, setComplianceAlerts] = useState<ComplianceAlerts | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);

    try {
      const token = await getToken();
      if (!token) {
        setError("Authentication required. Please sign in again.");
        return;
      }

      const [controlRes, metricsRes, complianceRes, reportRes, alertsRes] = await Promise.all([
        fetchWithToken<{ data: ControlState }>(`${API_URL}/api/v1/assist/outbound-calls/control`, token),
        fetchWithToken<{ data: MetricsState }>(`${API_URL}/api/v1/assist/outbound-calls/metrics`, token),
        fetchWithToken<{ data: ComplianceDecisionRow[] }>(`${API_URL}/api/v1/assist/compliance/decisions?limit=25&decision=open`, token),
        fetchWithToken<{ data: ComplianceReport }>(`${API_URL}/api/v1/assist/compliance/report?days=7`, token),
        fetchWithToken<{ data: ComplianceAlerts }>(`${API_URL}/api/v1/assist/compliance/alerts`, token),
      ]);

      if (!controlRes || !metricsRes) {
        setError("Could not load outbound control data.");
        return;
      }

      setControl(controlRes.data);
      setPausedReasonDraft(controlRes.data.pausedReason ?? "");
      setMaxConcurrentDraft(controlRes.data.maxConcurrentCalls ?? 3);
      setMetrics(metricsRes.data);
      setComplianceRows(complianceRes?.data ?? []);
      setComplianceReport(reportRes?.data ?? null);
      setComplianceAlerts(alertsRes?.data ?? null);
      setError(null);
    } catch {
      setError("Could not load outbound control data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getToken]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      void load();
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
        data?: {
          enqueued?: number;
          blockedByCompliance?: Array<{ prospectId: string }>;
        };
      };

      if (!res.ok) {
        throw new Error(body.message ?? body.error ?? "Failed to enqueue outbound calls");
      }

      const enqueued = Number(body.data?.enqueued ?? 0);
      const blocked = Number(body.data?.blockedByCompliance?.length ?? 0);
      const blockedSuffix = blocked > 0 ? ` ${blocked} blocked for compliance review.` : "";
      setEnqueueResult(`${enqueued} outbound call${enqueued === 1 ? "" : "s"} queued.${blockedSuffix}`);
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

  const canPauseResume = control.canManage && !saving && !control.globalPaused;

  return (
    <div className="p-4 md:p-8 max-w-6xl pb-28 md:pb-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Call Control Center</h1>
          <p className="text-sm text-stone-400 mt-0.5">Outbound pipeline controls, live counters, and queue safety toggles.</p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading || refreshing}
          className="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[#E8E6E1] bg-white text-sm text-stone-700 hover:bg-stone-50"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Refreshing..." : "Refresh"}
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

      <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-amber-600 text-white text-sm font-medium disabled:opacity-50"
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
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"
            >
              Enable Outbound
            </button>
            <button
              onClick={() => patchControl({ enabled: false, paused: true, pausedReason: pausedReasonDraft || "disabled by user" })}
              disabled={!control.canManage || saving || !control.enabled}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-stone-700 text-white text-sm font-medium disabled:opacity-50"
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
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-rose-600 text-white text-sm font-medium disabled:opacity-50"
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
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-medium disabled:opacity-50"
            >
              <PlayCircle size={14} />
              Resume Outbound
            </button>
            <button
              onClick={() => patchControl({ maxConcurrentCalls: maxConcurrentDraft, pausedReason: pausedReasonDraft })}
              disabled={!control.canManage || saving}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-[#E8E6E1] bg-white text-sm font-medium text-stone-700 disabled:opacity-50"
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
                      <span className="font-medium text-stone-700">{row.status.replace(/_/g, " ")}</span>
                      <span className="text-xs text-stone-400">{new Date(row.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-stone-500 mt-1">Outcome: {formatOutcome(row.outcome)}</p>
                    <p className="text-xs text-stone-500">Attempts: {row.attemptCount}/{row.maxAttempts}</p>
                    <p className="text-xs text-stone-500">Next attempt: {row.nextAttemptAt ? new Date(row.nextAttemptAt).toLocaleString() : "-"}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className="mt-5 rounded-[14px] border border-[#E8E6E1] bg-white p-5">
        <h2 className="text-sm font-semibold text-stone-800">Compliance Review Queue</h2>
        <p className="mt-1 text-xs text-stone-500">Latest blocked and manual-review decisions from strict-mode evaluator.</p>

        <div className="mt-4 max-h-[320px] overflow-y-auto rounded-lg border border-[#F0EEE9]">
          {loading ? (
            <p className="px-4 py-4 text-sm text-stone-500">Loading...</p>
          ) : complianceRows.length === 0 ? (
            <p className="px-4 py-4 text-sm text-stone-500">No open compliance decisions.</p>
          ) : (
            <ul className="divide-y divide-[#F0EEE9]">
              {complianceRows.map((row) => (
                <li key={row.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          row.decision === "BLOCK" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {row.decision === "BLOCK" ? "Blocked" : "Manual review"}
                      </span>
                      <span className="font-medium text-stone-700">{row.ruleCode}</span>
                    </div>
                    <span className="text-xs text-stone-400">{new Date(row.evaluatedAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-xs text-stone-600">{row.explanation}</p>
                  <p className="mt-1 text-xs text-stone-500">
                    Prospect: {row.businessName || "Unknown"} {row.phone ? `(${row.phone})` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-5 rounded-[14px] border border-[#E8E6E1] bg-white p-5">
        <h2 className="text-sm font-semibold text-stone-800">Compliance Health</h2>
        <p className="mt-1 text-xs text-stone-500">7-day summary and spike alerts for blocked/manual-review decisions.</p>

        {complianceAlerts && (
          <div className="mt-3 space-y-2">
            {complianceAlerts.alerts.map((alert) => (
              <div
                key={alert.code}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  alert.level === "warning"
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-teal-200 bg-teal-50 text-teal-700"
                }`}
              >
                {alert.message}
              </div>
            ))}
          </div>
        )}

        {complianceReport && (
          <div className="mt-4 grid sm:grid-cols-3 gap-3">
            {["ALLOW", "BLOCK", "MANUAL_REVIEW"].map((decision) => {
              const count = complianceReport.totals.find((row) => row.decision === decision)?.count ?? 0;
              return (
                <div key={decision} className="rounded-lg border border-[#F0EEE9] px-3 py-2">
                  <p className="text-[11px] text-stone-500">{decision.replace("_", " ")}</p>
                  <p className="text-base font-semibold text-stone-800">{count}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="md:hidden fixed bottom-0 left-0 right-0 border-t border-[#E8E6E1] bg-white/95 backdrop-blur-sm p-3">
        <div className="max-w-6xl mx-auto grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="px-3 py-2.5 rounded-lg border border-[#E8E6E1] text-sm font-medium text-stone-700 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => patchControl({ paused: true, pausedReason: pausedReasonDraft || "paused from mobile" })}
            disabled={!canPauseResume}
            className="px-3 py-2.5 rounded-lg bg-rose-600 text-white text-sm font-medium disabled:opacity-50"
          >
            Pause
          </button>
          <button
            type="button"
            onClick={() => patchControl({ paused: false, pausedReason: pausedReasonDraft })}
            disabled={!canPauseResume}
            className="px-3 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-medium disabled:opacity-50"
          >
            Resume
          </button>
        </div>
      </div>
    </div>
  );
}
