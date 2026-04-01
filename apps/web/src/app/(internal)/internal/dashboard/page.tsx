import { auth } from "@clerk/nextjs/server";
import { TrendingUp, Clock, Zap, Database, AlertCircle } from "lucide-react";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

type Lead = {
  id: string;
  businessName: string;
  niche: string | null;
  domain: string | null;
  source: string;
  createdAt: string;
};

type Campaign = {
  id: string;
  name: string;
  active: boolean;
  approvedAt: string | null;
  channel: string;
};

async function apiFetch<T>(path: string, token: string | null): Promise<{ data: T | null; error: boolean }> {
  if (!token) return { data: null, error: false };
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return { data: null, error: true };
    return { data: await res.json(), error: false };
  } catch {
    return { data: null, error: true };
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function InternalDashboardPage() {
  const { getToken } = await auth();
  const token = await getToken();

  const [leadsResult, campaignsResult] = await Promise.all([
    apiFetch<{ data: Lead[] }>("/api/leads?limit=200", token),
    apiFetch<{ data: Campaign[] }>("/api/campaigns?limit=200", token),
  ]);

  const fetchError = leadsResult.error && campaignsResult.error;
  const leads: Lead[] = (leadsResult.data as { data: Lead[] } | null)?.data ?? [];
  const campaigns: Campaign[] = (campaignsResult.data as { data: Campaign[] } | null)?.data ?? [];

  const today = new Date().toDateString();
  const leadsToday = leads.filter(
    (l) => new Date(l.createdAt).toDateString() === today
  ).length;
  const pendingApprovals = campaigns.filter((c) => !c.approvedAt).length;
  const recentLeads = leads.slice(0, 6);

  const stats = [
    {
      label: "Leads today",
      value: leadsToday,
      sub: `${leads.length} total`,
      icon: TrendingUp,
      accent: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      label: "Pending approvals",
      value: pendingApprovals,
      sub: `${campaigns.length} campaigns`,
      icon: Clock,
      accent: "text-rose-500",
      bg: "bg-rose-50",
    },
    {
      label: "Token spend today",
      value: "—",
      sub: "endpoint coming",
      icon: Zap,
      accent: "text-violet-500",
      bg: "bg-violet-50",
    },
    {
      label: "Research cache hits",
      value: "—",
      sub: "endpoint coming",
      icon: Database,
      accent: "text-teal-600",
      bg: "bg-teal-50",
    },
  ];

  return (
    <div className="p-8 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Dashboard</h1>
        <p className="text-sm text-stone-400 mt-0.5">QYRO Lead — internal overview</p>
      </div>

      {fetchError && (
        <div className="mt-4 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-rose-50 border border-rose-100">
          <AlertCircle size={15} className="text-rose-500 shrink-0" />
          <p className="text-sm text-rose-700">
            Could not reach the API — data shown may be incomplete. Make sure the API server is running.
          </p>
        </div>
      )}

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map(({ label, value, sub, icon: Icon, accent, bg }) => (
          <div
            key={label}
            className="bg-white border border-[#E8E6E1] rounded-[14px] p-5 shadow-[0_1px_4px_rgba(0,0,0,0.05)]"
          >
            <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center mb-3`}>
              <Icon size={15} className={accent} strokeWidth={2} />
            </div>
            <p className="text-2xl font-semibold text-stone-900 tabular-nums">{value}</p>
            <p className="text-xs text-stone-500 mt-0.5 font-medium">{label}</p>
            <p className="text-xs text-stone-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Recent leads */}
      <div className="mt-6 bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#F0EEE9]">
          <p className="text-sm font-medium text-stone-800">Recent leads</p>
        </div>

        {recentLeads.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-stone-400">No leads yet. Run lead discovery to populate.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[#F0EEE9]">
            {recentLeads.map((lead) => (
              <li key={lead.id} className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-[#FAFAF8] transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-800 truncate">{lead.businessName}</p>
                  <p className="text-xs text-stone-400 truncate mt-0.5">
                    {lead.domain ?? "—"}{lead.niche ? ` · ${lead.niche}` : ""}
                  </p>
                </div>
                <p className="text-xs text-stone-400 shrink-0">{formatDate(lead.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Campaigns */}
      {campaigns.length > 0 && (
        <div className="mt-4 bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#F0EEE9]">
            <p className="text-sm font-medium text-stone-800">Active campaigns</p>
          </div>
          <ul className="divide-y divide-[#F0EEE9]">
            {campaigns.slice(0, 5).map((c) => (
              <li key={c.id} className="px-5 py-3 flex items-center justify-between gap-4">
                <p className="text-sm text-stone-700 font-medium">{c.name}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-400 uppercase tracking-wide">{c.channel}</span>
                  {c.active ? (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-teal-50 text-teal-700">Active</span>
                  ) : (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">Pending</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
