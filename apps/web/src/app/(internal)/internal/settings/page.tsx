"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Save, CheckCircle } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

type EnrichmentProvider = "mock" | "apollo" | "hunter";

type TenantSettingsResponse = {
  enrichmentProvider?: EnrichmentProvider;
  outreachEnabled?: boolean;
  apolloApiKeyMasked?: string;
  hunterApiKeyMasked?: string;
  hasApolloApiKey?: boolean;
  hasHunterApiKey?: boolean;
  enrichmentMonthlyLimit?: number;
  enrichmentMonthlyUsed?: number;
};

type SettingsForm = {
  enrichmentProvider: EnrichmentProvider;
  outreachEnabled: boolean;
  apolloApiKey: string;
  hunterApiKey: string;
  apolloApiKeyMasked: string;
  hunterApiKeyMasked: string;
  hasApolloApiKey: boolean;
  hasHunterApiKey: boolean;
  enrichmentMonthlyLimit: number;
  enrichmentMonthlyUsed: number;
};

export default function InternalSettingsPage() {
  const { getToken } = useAuth();

  const [form, setForm] = useState<SettingsForm>({
    enrichmentProvider: "mock",
    outreachEnabled: true,
    apolloApiKey: "",
    hunterApiKey: "",
    apolloApiKeyMasked: "",
    hunterApiKeyMasked: "",
    hasApolloApiKey: false,
    hasHunterApiKey: false,
    enrichmentMonthlyLimit: 2500,
    enrichmentMonthlyUsed: 0,
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const token = await getToken();
      if (!token) return;

      try {
        const res = await fetch(`${API_URL}/api/v1/tenants/settings`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const data = (await res.json()) as TenantSettingsResponse;
          setForm({
            enrichmentProvider: (data.enrichmentProvider ?? "mock") as EnrichmentProvider,
            outreachEnabled: data.outreachEnabled !== false,
            apolloApiKey: "",
            hunterApiKey: "",
            apolloApiKeyMasked: data.apolloApiKeyMasked ?? "",
            hunterApiKeyMasked: data.hunterApiKeyMasked ?? "",
            hasApolloApiKey: Boolean(data.hasApolloApiKey),
            hasHunterApiKey: Boolean(data.hasHunterApiKey),
            enrichmentMonthlyLimit: Number(data.enrichmentMonthlyLimit ?? 2500),
            enrichmentMonthlyUsed: Number(data.enrichmentMonthlyUsed ?? 0),
          });
        }
      } catch {
        setError("Could not load settings.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [getToken]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const token = await getToken();
      const payload: Record<string, unknown> = {
        enrichmentProvider: form.enrichmentProvider,
        outreachEnabled: form.outreachEnabled,
        enrichmentMonthlyLimit: form.enrichmentMonthlyLimit,
      };

      if (form.apolloApiKey.trim()) payload.apolloApiKey = form.apolloApiKey.trim();
      if (form.hunterApiKey.trim()) payload.hunterApiKey = form.hunterApiKey.trim();

      const res = await fetch(`${API_URL}/api/v1/tenants/settings`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        setError("Save failed. Please try again.");
        return;
      }

      const settingsRes = await fetch(`${API_URL}/api/v1/tenants/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (settingsRes.ok) {
        const data = (await settingsRes.json()) as TenantSettingsResponse;
        setForm((prev) => ({
          ...prev,
          apolloApiKey: "",
          hunterApiKey: "",
          outreachEnabled: data.outreachEnabled !== false,
          apolloApiKeyMasked: data.apolloApiKeyMasked ?? "",
          hunterApiKeyMasked: data.hunterApiKeyMasked ?? "",
          hasApolloApiKey: Boolean(data.hasApolloApiKey),
          hasHunterApiKey: Boolean(data.hasHunterApiKey),
          enrichmentMonthlyLimit: Number(data.enrichmentMonthlyLimit ?? prev.enrichmentMonthlyLimit),
          enrichmentMonthlyUsed: Number(data.enrichmentMonthlyUsed ?? prev.enrichmentMonthlyUsed),
        }));
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-xl font-semibold text-stone-900">Settings</h1>
      <p className="text-sm text-stone-500 mt-1">Lead enrichment provider and monthly credit controls</p>

      {loading ? (
        <div className="mt-6 bg-white border border-[#E8E6E1] rounded-[12px] p-5">
          <p className="text-sm text-stone-400">Loading settings…</p>
        </div>
      ) : (
        <form onSubmit={handleSave} className="mt-6 space-y-5">
          <div className="bg-white border border-[#E8E6E1] rounded-[14px] p-6 space-y-5">
            <p className="text-sm font-semibold text-stone-800">Enrichment provider</p>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700">Provider</label>
              <select
                className="input"
                value={form.enrichmentProvider}
                onChange={(e) =>
                  setForm({ ...form, enrichmentProvider: e.target.value as EnrichmentProvider })
                }
              >
                <option value="mock">Mock (dev)</option>
                <option value="apollo">Apollo</option>
                <option value="hunter">Hunter</option>
              </select>
              <p className="text-xs text-stone-400">
                Switch providers without backend changes.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700">Outreach enabled</label>
              <label className="inline-flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={form.outreachEnabled}
                  onChange={(e) => setForm({ ...form, outreachEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
                />
                Enable research and outreach job queueing for new discovered prospects
              </label>
              <p className="text-xs text-stone-400">
                If disabled, newly discovered prospects are stored but marked as skipped before research.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700">Apollo API key</label>
              <input
                type="password"
                className="input"
                value={form.apolloApiKey}
                onChange={(e) => setForm({ ...form, apolloApiKey: e.target.value })}
                placeholder={form.hasApolloApiKey ? `Saved: ${form.apolloApiKeyMasked}` : "Enter Apollo key"}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700">Hunter API key</label>
              <input
                type="password"
                className="input"
                value={form.hunterApiKey}
                onChange={(e) => setForm({ ...form, hunterApiKey: e.target.value })}
                placeholder={form.hasHunterApiKey ? `Saved: ${form.hunterApiKeyMasked}` : "Enter Hunter key"}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700">Monthly credit limit</label>
              <input
                type="number"
                min={0}
                className="input"
                value={form.enrichmentMonthlyLimit}
                onChange={(e) =>
                  setForm({ ...form, enrichmentMonthlyLimit: Math.max(0, Number(e.target.value) || 0) })
                }
              />
              <p className="text-xs text-stone-400">
                Used this month: {form.enrichmentMonthlyUsed} / {form.enrichmentMonthlyLimit}
              </p>
            </div>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? "Saving..." : "Save changes"}
            </button>

            {saved && (
              <span className="flex items-center gap-1.5 text-sm text-teal-600 font-medium">
                <CheckCircle size={14} />
                Saved
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
