"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

type Access = { lead: boolean; assist: boolean };

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  plan: string;
  subscriptionStatus: string;
  baseAccess: Access;
  billingOverrideAccess: Access;
  trial: {
    active: boolean;
    expiresAt: string | null;
    callsRemaining: number;
    productAccess: Access;
  };
  voice: {
    voiceNumber: string;
    voiceRuntime: "signalwire" | "retell";
    retellAgentId: string;
  };
};

type VoiceForm = {
  tenantId: string;
  voiceNumber: string;
  voiceRuntime: "signalwire" | "retell";
  retellAgentId: string;
};

export default function MasterAdminPage() {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [voiceForm, setVoiceForm] = useState<VoiceForm>({
    tenantId: "",
    voiceNumber: "",
    voiceRuntime: "signalwire",
    retellAgentId: "",
  });
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [voiceSaved, setVoiceSaved] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const sortedRows = useMemo(() => [...rows].sort((a, b) => a.name.localeCompare(b.name)), [rows]);

  async function fetchTenants() {
    const token = await getToken();
    if (!token) return;

    const res = await fetch(`${API_URL}/api/v1/admin/tenants`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({} as { message?: string }));
      throw new Error((body as { message?: string }).message ?? "Could not load tenants");
    }

    const body = (await res.json()) as { data: TenantRow[] };
    setRows(body.data ?? []);
  }

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken();
        if (!token) return;

        const meRes = await fetch(`${API_URL}/api/v1/admin/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!meRes.ok) {
          setAuthorized(false);
          setLoading(false);
          return;
        }

        setAuthorized(true);
        await fetchTenants();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load admin panel");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [getToken]);

  async function saveTenant(row: TenantRow) {
    setSavingId(row.id);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;

      const payload = {
        billingOverrideAccess: row.billingOverrideAccess,
        trialCalls: row.trial.callsRemaining,
        trialProductAccess: row.trial.productAccess,
        ...(row.trial.expiresAt
          ? {
              trialDays: Math.max(0, Math.ceil((new Date(row.trial.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
            }
          : {}),
      };

      const res = await fetch(`${API_URL}/api/v1/admin/tenants/${row.id}/access`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { message?: string }));
        throw new Error((body as { message?: string }).message ?? "Failed to save tenant access");
      }

      await fetchTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingId(null);
    }
  }

  async function clearTrial(row: TenantRow) {
    setSavingId(row.id);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch(`${API_URL}/api/v1/admin/tenants/${row.id}/access`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clearTrial: true }),
      });

      if (!res.ok) throw new Error("Failed to clear trial");
      await fetchTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trial clear failed");
    } finally {
      setSavingId(null);
    }
  }

  function selectVoiceTenant(tenantId: string) {
    const row = rows.find((r) => r.id === tenantId);
    setVoiceForm({
      tenantId,
      voiceNumber: row?.voice?.voiceNumber ?? "",
      voiceRuntime: row?.voice?.voiceRuntime ?? "signalwire",
      retellAgentId: row?.voice?.retellAgentId ?? "",
    });
    setVoiceSaved(false);
    setVoiceError(null);
  }

  async function handleVoiceSave(e: React.FormEvent) {
    e.preventDefault();
    if (!voiceForm.tenantId) {
      setVoiceError("Select a tenant first.");
      return;
    }
    if (voiceForm.retellAgentId.trim() && voiceForm.voiceRuntime !== "retell") {
      setVoiceError("Retell Agent ID is set but Voice Runtime is not 'Retell AI'.");
      return;
    }
    setVoiceSaving(true);
    setVoiceError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/tenants/${voiceForm.tenantId}/voice`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          voiceNumber: voiceForm.voiceNumber,
          voiceRuntime: voiceForm.voiceRuntime,
          retellAgentId: voiceForm.retellAgentId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { message?: string }));
        throw new Error((body as { message?: string }).message ?? "Save failed");
      }
      await fetchTenants();
      setVoiceSaved(true);
      setTimeout(() => setVoiceSaved(false), 3000);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setVoiceSaving(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-sm text-stone-500">Loading admin panel…</div>;
  }

  if (!authorized) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-xl font-semibold text-stone-900">Master Admin</h1>
        <p className="mt-2 text-sm text-rose-600">
          You do not have master-admin access. Set your user role to master_admin or configure MASTER_ADMIN_CLERK_IDS / MASTER_ADMIN_EMAILS in API env vars.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-xl font-semibold text-stone-900">Master Admin</h1>
      <p className="mt-1 text-sm text-stone-500">Voice configuration and tenant access controls.</p>

      {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

      {/* ── Voice Configuration ─────────────────────────────────────────── */}
      <div className="mt-8">
        <h2 className="text-base font-semibold text-stone-900">Voice Configuration</h2>
        <p className="mt-0.5 text-sm text-stone-500">Set voice_number, voice_runtime, and Retell agent ID for any client tenant.</p>

        <form onSubmit={(e) => void handleVoiceSave(e)} className="mt-4 rounded-xl border border-[#E8E6E1] bg-white p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-stone-700">Tenant</label>
            <select
              className="input"
              value={voiceForm.tenantId}
              onChange={(e) => selectVoiceTenant(e.target.value)}
            >
              <option value="">— select a tenant —</option>
              {sortedRows.map((r) => (
                <option key={r.id} value={r.id}>{r.name} ({r.slug})</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-stone-700">Voice number</label>
            <input
              className="input"
              value={voiceForm.voiceNumber}
              onChange={(e) => setVoiceForm({ ...voiceForm, voiceNumber: e.target.value })}
              placeholder="+15035551234"
            />
            <p className="text-xs text-stone-400">E.164 format. The number the client&apos;s customers call.</p>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-stone-700">Voice runtime</label>
            <select
              className="input"
              value={voiceForm.voiceRuntime}
              onChange={(e) => setVoiceForm({ ...voiceForm, voiceRuntime: e.target.value as "signalwire" | "retell" })}
            >
              <option value="signalwire">SignalWire Direct</option>
              <option value="retell">Retell AI</option>
            </select>
          </div>

          {voiceForm.voiceRuntime === "retell" && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700">Retell Agent ID</label>
              <input
                className="input"
                value={voiceForm.retellAgentId}
                onChange={(e) => setVoiceForm({ ...voiceForm, retellAgentId: e.target.value })}
                placeholder="agent_xxxxxxxxxxxx"
              />
              <p className="text-xs text-stone-400">Find this in Retell dashboard → Agents.</p>
            </div>
          )}

          {voiceError && <p className="text-sm text-rose-600">{voiceError}</p>}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={voiceSaving || !voiceForm.tenantId}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors disabled:opacity-50"
            >
              {voiceSaving ? "Saving…" : "Save voice settings"}
            </button>
            {voiceSaved && (
              <span className="text-sm text-teal-600 font-medium">Saved</span>
            )}
          </div>
        </form>
      </div>

      {/* ── Tenant Access / Trial ────────────────────────────────────────── */}
      <div className="mt-10">
        <h2 className="text-base font-semibold text-stone-900">Tenant Access &amp; Trials</h2>
        <p className="mt-0.5 text-sm text-stone-500">Grant or revoke paid bypass access and trial limits.</p>
      </div>

      <div className="mt-4 space-y-4">
        {sortedRows.map((row) => (
          <div key={row.id} className="rounded-xl border border-[#E8E6E1] bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-stone-900">{row.name}</p>
                <p className="text-xs text-stone-500">{row.slug} • plan: {row.plan} • subscription: {row.subscriptionStatus}</p>
              </div>
              <button
                type="button"
                onClick={() => void saveTenant(row)}
                disabled={savingId === row.id}
                className="px-3 py-2 text-xs font-medium rounded-lg bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-60"
              >
                {savingId === row.id ? "Saving..." : "Save"}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="rounded-lg border border-[#E8E6E1] p-3">
                <p className="font-medium text-stone-700">Billing Override Access</p>
                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={row.billingOverrideAccess.lead}
                    onChange={(e) => setRows((prev) => prev.map((x) => x.id === row.id ? { ...x, billingOverrideAccess: { ...x.billingOverrideAccess, lead: e.target.checked } } : x))}
                  />
                  Lead access
                </label>
                <label className="mt-1 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={row.billingOverrideAccess.assist}
                    onChange={(e) => setRows((prev) => prev.map((x) => x.id === row.id ? { ...x, billingOverrideAccess: { ...x.billingOverrideAccess, assist: e.target.checked } } : x))}
                  />
                  Assist access
                </label>
              </div>

              <div className="rounded-lg border border-[#E8E6E1] p-3">
                <p className="font-medium text-stone-700">Trial Product Access</p>
                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={row.trial.productAccess.lead}
                    onChange={(e) => setRows((prev) => prev.map((x) => x.id === row.id ? { ...x, trial: { ...x.trial, productAccess: { ...x.trial.productAccess, lead: e.target.checked } } } : x))}
                  />
                  Trial Lead
                </label>
                <label className="mt-1 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={row.trial.productAccess.assist}
                    onChange={(e) => setRows((prev) => prev.map((x) => x.id === row.id ? { ...x, trial: { ...x.trial, productAccess: { ...x.trial.productAccess, assist: e.target.checked } } } : x))}
                  />
                  Trial Assist
                </label>
              </div>

              <div className="rounded-lg border border-[#E8E6E1] p-3">
                <p className="font-medium text-stone-700">Trial Limits</p>
                <label className="mt-2 block text-xs text-stone-500">Calls remaining</label>
                <input
                  className="input mt-1"
                  type="number"
                  min={0}
                  value={row.trial.callsRemaining}
                  onChange={(e) => setRows((prev) => prev.map((x) => x.id === row.id ? { ...x, trial: { ...x.trial, callsRemaining: Math.max(0, Number(e.target.value) || 0) } } : x))}
                />
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs text-stone-500">{row.trial.active ? `Active until ${row.trial.expiresAt}` : "Not active"}</p>
                  <button
                    type="button"
                    onClick={() => void clearTrial(row)}
                    disabled={savingId === row.id}
                    className="text-xs font-medium text-rose-600 hover:text-rose-700"
                  >
                    Clear trial
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
