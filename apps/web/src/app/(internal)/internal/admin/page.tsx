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
};

export default function MasterAdminPage() {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  const sortedRows = useMemo(() => [...rows].sort((a, b) => a.name.localeCompare(b.name)), [rows]);

  async function fetchTenants() {
    const token = await getToken();
    if (!token) return;

    const res = await fetch(`${API_URL}/api/v1/admin/tenants`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({} as { message?: string }));
      throw new Error(body.message ?? "Could not load tenants");
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
        throw new Error(body.message ?? "Failed to save tenant access");
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

  if (loading) {
    return <div className="p-8 text-sm text-stone-500">Loading admin panel…</div>;
  }

  if (!authorized) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-xl font-semibold text-stone-900">Master Admin</h1>
        <p className="mt-2 text-sm text-rose-600">
          You do not have master-admin access yet. Set your user role to master_admin or configure MASTER_ADMIN_CLERK_IDS / MASTER_ADMIN_EMAILS in API env vars.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-xl font-semibold text-stone-900">Master Admin Control</h1>
      <p className="mt-1 text-sm text-stone-500">Grant or revoke paid bypass access and trial limits across all tenants.</p>

      {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

      <div className="mt-6 space-y-4">
        {sortedRows.map((row) => (
          <div key={row.id} className="rounded-xl border border-[#E8E6E1] bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-stone-900">{row.name}</h2>
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
