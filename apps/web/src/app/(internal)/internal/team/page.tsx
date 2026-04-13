"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

type Access = { lead: boolean; assist: boolean };

type TeamUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  active: boolean;
  productAccess: Access;
  accessOverride: Access | null;
};

const ROLE_OPTIONS = ["owner", "admin", "operator", "sales_rep", "analyst", "client_viewer"] as const;

export default function TeamPage() {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TeamUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (a.role === "owner" && b.role !== "owner") return -1;
      if (b.role === "owner" && a.role !== "owner") return 1;
      return (a.name || a.email).localeCompare(b.name || b.email);
    });
  }, [rows]);

  const loadUsers = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    const res = await fetch(`${API_URL}/api/v1/tenants/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({} as { message?: string }));
      throw new Error(body.message ?? "Could not load team users");
    }

    const body = (await res.json()) as { data?: TeamUser[] };
    setRows(body.data ?? []);
  }, [getToken]);

  useEffect(() => {
    async function run() {
      try {
        await loadUsers();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load team users");
      } finally {
        setLoading(false);
      }
    }
    void run();
  }, [loadUsers]);

  async function saveRow(row: TeamUser) {
    setSavingId(row.id);
    setError(null);

    try {
      const token = await getToken();
      if (!token) return;

      const payload = {
        role: row.role,
        active: row.active,
        access: {
          lead: row.accessOverride?.lead ?? row.productAccess.lead,
          assist: row.accessOverride?.assist ?? row.productAccess.assist,
        },
      };

      const res = await fetch(`${API_URL}/api/v1/tenants/users/${row.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { message?: string }));
        throw new Error(body.message ?? "Could not save user changes");
      }

      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save user changes");
    } finally {
      setSavingId(null);
    }
  }

  function setOverrideValue(userId: string, key: "lead" | "assist", value: boolean) {
    setRows((prev) => prev.map((row) => {
      if (row.id !== userId) return row;
      const current = row.accessOverride ?? { ...row.productAccess };
      return {
        ...row,
        accessOverride: {
          ...current,
          [key]: value,
        },
      };
    }));
  }

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-xl font-semibold text-stone-900">Team Permissions</h1>
      <p className="mt-1 text-sm text-stone-500">Owners and admins can control user role, active state, and product access per user.</p>

      {loading ? (
        <div className="mt-6 text-sm text-stone-500">Loading team users…</div>
      ) : (
        <div className="mt-6 space-y-4">
          {error && <p className="text-sm text-rose-600">{error}</p>}

          {sortedRows.map((row) => (
            <div key={row.id} className="rounded-xl border border-[#E8E6E1] bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-stone-900">{row.name || row.email}</p>
                  <p className="text-xs text-stone-500">{row.email}</p>
                </div>

                <button
                  type="button"
                  onClick={() => void saveRow(row)}
                  disabled={savingId === row.id}
                  className="px-3 py-2 text-xs font-medium rounded-lg bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-60"
                >
                  {savingId === row.id ? "Saving..." : "Save"}
                </button>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-600">Role</label>
                  <select
                    className="input mt-1"
                    value={row.role}
                    onChange={(e) => {
                      const value = e.target.value;
                      setRows((prev) => prev.map((x) => x.id === row.id ? { ...x, role: value } : x));
                    }}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-600">Status</label>
                  <label className="mt-3 flex items-center gap-2 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      checked={row.active}
                      onChange={(e) => setRows((prev) => prev.map((x) => x.id === row.id ? { ...x, active: e.target.checked } : x))}
                    />
                    Active user
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-600">Product access override</label>
                  <div className="mt-2 space-y-1.5 text-sm text-stone-700">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={row.accessOverride?.lead ?? row.productAccess.lead}
                        onChange={(e) => setOverrideValue(row.id, "lead", e.target.checked)}
                      />
                      Lead
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={row.accessOverride?.assist ?? row.productAccess.assist}
                        onChange={(e) => setOverrideValue(row.id, "assist", e.target.checked)}
                      />
                      Assist
                    </label>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
