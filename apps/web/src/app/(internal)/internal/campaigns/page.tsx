import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { Plus } from "lucide-react";
import { activateCampaignAction } from "./actions";

const API_URL = process.env.API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

type Campaign = {
  id: string;
  name: string;
  niche: string | null;
  channel: string;
  promptPackId: string;
  active: boolean;
  approvedAt: string | null;
  createdAt: string;
};

function ChannelBadge({ channel }: { channel: string }) {
  const map: Record<string, string> = {
    email: "bg-sky-50 text-sky-700",
    sms:   "bg-violet-50 text-violet-700",
    voice: "bg-teal-50 text-teal-700",
  };
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wide ${map[channel] ?? "bg-stone-100 text-stone-500"}`}>
      {channel}
    </span>
  );
}

export default async function CampaignsPage() {
  const { getToken } = await auth();
  const token = await getToken();

  let campaigns: Campaign[] = [];
  let fetchError = false;

  if (token) {
    try {
      const res = await fetch(`${API_URL}/api/campaigns?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        campaigns = data.data ?? [];
      } else {
        fetchError = true;
      }
    } catch {
      fetchError = true;
    }
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Campaigns</h1>
          <p className="text-sm text-stone-400 mt-0.5">
            Outreach sequences · {campaigns.length} total
          </p>
        </div>
        <Link
          href="/internal/campaigns/new"
          className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors"
        >
          <Plus size={14} />
          Create campaign
        </Link>
      </div>

      {/* Table card */}
      <div className="mt-6 bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
        {fetchError ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-rose-500 font-medium">Could not reach API</p>
            <p className="text-xs text-stone-400 mt-1">
              Make sure API_URL / NEXT_PUBLIC_API_URL points to https://api.qyro.us.
            </p>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-stone-500 font-medium">No campaigns yet</p>
            <p className="text-xs text-stone-400 mt-1 mb-4">
              Create an outreach sequence to get started.
            </p>
            <Link
              href="/internal/campaigns/new"
              className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 transition-colors"
            >
              <Plus size={14} />
              New campaign
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-[#F0EEE9] bg-[#FAFAF8]">
                <th className="text-left px-5 py-3 text-xs font-medium text-stone-400 uppercase tracking-wide">
                  Name
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-400 uppercase tracking-wide">
                  Niche
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-400 uppercase tracking-wide">
                  Channel
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-400 uppercase tracking-wide">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-400 uppercase tracking-wide">
                  Prompt pack
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F5F4F1]">
              {campaigns.map((campaign) => (
                <tr
                  key={campaign.id}
                  className="hover:bg-[#FAFAF8] transition-colors group"
                >
                  <td className="px-5 py-3">
                    <p className="font-medium text-stone-800">{campaign.name}</p>
                  </td>
                  <td className="px-4 py-3 text-stone-500">
                    {campaign.niche ?? <span className="text-stone-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <ChannelBadge channel={campaign.channel} />
                  </td>
                  <td className="px-4 py-3">
                    {campaign.active ? (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-teal-50 text-teal-700">
                        Active
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-stone-400">
                      {campaign.promptPackId}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      {!campaign.active && (
                        <form action={activateCampaignAction}>
                          <input type="hidden" name="id" value={campaign.id} />
                          <button
                            type="submit"
                            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-teal-500 text-white hover:bg-teal-600 transition-colors"
                          >
                            Activate
                          </button>
                        </form>
                      )}
                      <Link
                        href="/internal/approvals"
                        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[#E8E6E1] text-stone-600 hover:bg-stone-50 transition-colors"
                      >
                        View queue
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
