import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { LeadsRefresher } from "./LeadsRefresher";
import { runResearchAction, runResearchBatchAction, runOutreachBatchAction, runOutboundBatchAction } from "./actions";
import PendingSubmitButton from "./PendingSubmitButton";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");
const PAGE_SIZE = 25;

type Lead = {
  id: string;
  businessName: string;
  niche: string | null;
  domain: string | null;
  phone: string | null;
  email: string | null;  // Added email field
  source: string;
  consentState: string;
  deduped: boolean;
  createdAt: string;
  researchedAt: string | null;
  urgencyScore: number | null;
  fromCache: boolean | null;
};

type Campaign = {
  id: string;
  name: string;
  channel: string;
  active: boolean;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; className: string }> = {
    apollo: { label: "Apollo", className: "bg-violet-50 text-violet-700" },
    google: { label: "Google Places", className: "bg-sky-50 text-sky-700" },
    places_api: { label: "Places", className: "bg-sky-50 text-sky-700" },
    inbound_form: { label: "Manual", className: "bg-stone-100 text-stone-600" },
  };
  const entry = map[source] ?? { label: source, className: "bg-stone-100 text-stone-600" };
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${entry.className}`}>
      {entry.label}
    </span>
  );
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = Math.max(0, parseInt(searchParams.page ?? "0", 10));
  const offset = page * PAGE_SIZE;

  const { getToken } = await auth();
  const token = await getToken();
  const bypassAuth = process.env.DEV_BYPASS_AUTH === "true";

  let leads: Lead[] = [];
  let activeOutreachCampaigns: Campaign[] = [];
  let fetchError = false;

  if (token || bypassAuth) {
    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(
        `${API_URL}/api/leads?limit=${PAGE_SIZE}&offset=${offset}`,
        {
          headers,
          cache: "no-store",
        }
      );
      if (res.ok) {
        const data = await res.json();
        leads = data.data ?? [];
      } else {
        fetchError = true;
      }

      const campaignsRes = await fetch(`${API_URL}/api/campaigns?limit=100`, {
        headers,
        cache: "no-store",
      });
      if (campaignsRes.ok) {
        const campaignsData = await campaignsRes.json();
        const allCampaigns: Campaign[] = campaignsData.data ?? [];
        activeOutreachCampaigns = allCampaigns.filter((c) => c.active && (c.channel === "email" || c.channel === "sms"));
      }
    } catch {
      fetchError = true;
    }
  }

  const hasMore = leads.length === PAGE_SIZE;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Leads</h1>
          <p className="text-sm text-stone-400 mt-0.5">
            {page === 0 ? "Most recent prospects" : `Page ${page + 1}`}
          </p>
        </div>
        <LeadsRefresher />
      </div>

      <div className="mt-6 bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
        {fetchError ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-rose-500 font-medium">Could not reach API</p>
            <p className="text-xs text-stone-400 mt-1">
              Make sure API_URL / NEXT_PUBLIC_API_URL points to https://api.qyro.us.
            </p>
          </div>
        ) : leads.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-stone-500 font-medium">No leads found</p>
            <p className="text-xs text-stone-400 mt-1">
              {page > 0
                ? "You've reached the end of the list."
                : "Use 'Find Leads' above to discover prospects."}
            </p>
          </div>
        ) : (
          <div>
            <div className="px-4 py-3 border-b border-[#F0EEE9] bg-[#FCFBF8] flex flex-wrap items-center gap-2">
              <form
                action={async (formData: FormData) => {
                  "use server";
                  const ids = formData.getAll("leadIds").map((v) => String(v));
                  await runResearchBatchAction(ids);
                }}
                className="inline-flex items-center"
              >
                <div className="hidden">
                  {leads.map((lead) => (
                    <input key={lead.id} type="checkbox" name="leadIds" value={lead.id} />
                  ))}
                </div>
                <PendingSubmitButton
                  idleLabel={`Research All Visible (${leads.length})`}
                  pendingLabel="Queuing all..."
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 transition-colors disabled:opacity-60"
                />
              </form>
              <span className="text-xs text-stone-500">For selected leads, use checkboxes and click the button at table bottom.</span>
            </div>

            <form
              action={async (formData: FormData) => {
                "use server";
                const ids = formData.getAll("leadIds").map((v) => String(v));
                await runResearchBatchAction(ids);
              }}
            >
            <div className="overflow-x-auto">
            <table className="w-full min-w-[1020px] text-sm">
              <thead>
                <tr className="border-b border-[#F0EEE9] bg-[#FAFAF8]">
                  <th className="w-[40px] px-2 py-3">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="w-[220px] text-left px-5 py-3 text-xs font-medium text-stone-400 uppercase tracking-wide">
                    Business
                  </th>
                  <th className="w-[110px] text-left px-4 py-3 text-xs font-medium text-stone-400 uppercase tracking-wide">
                    Niche
                  </th>
                  <th className="w-[260px] text-left px-4 py-3 text-xs font-medium text-stone-400 uppercase tracking-wide">
                    Domain
                  </th>
                  <th className="w-[150px] text-left px-4 py-3 text-xs font-medium text-stone-400 uppercase tracking-wide whitespace-nowrap">
                    Phone
                  </th>
                  <th className="w-[210px] text-left px-4 py-3 text-xs font-medium text-stone-400 uppercase tracking-wide">
                    Email
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-stone-400 uppercase tracking-wide">
                    Urgency
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-stone-400 uppercase tracking-wide">
                    Research
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-stone-400 uppercase tracking-wide">
                    Added
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F5F4F1]">
                {leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-[#FAFAF8] transition-colors group">
                    <td className="px-2 py-3 align-top">
                      <input
                        type="checkbox"
                        name="leadIds"
                        value={lead.id}
                        className="h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
                        aria-label={`Select ${lead.businessName}`}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-stone-800 truncate max-w-[200px]">
                          {lead.businessName}
                        </p>
                        <SourceBadge source={lead.source} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-stone-500 whitespace-nowrap">
                      {lead.niche ?? <span className="text-stone-300">—</span>}
                    </td>
                    <td className="px-4 py-3 max-w-[260px]">
                      {lead.domain ? (
                        <span className="block text-stone-500 font-mono text-xs truncate" title={lead.domain}>{lead.domain}</span>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {lead.phone ? (
                        <span className="text-stone-500 font-mono text-xs tabular-nums">{lead.phone}</span>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-[210px]">
                      {lead.email ? (
                        <span className="block text-stone-500 font-mono text-xs truncate" title={lead.email}>{lead.email}</span>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-stone-300 tabular-nums">
                      {lead.urgencyScore ? (
                        <span className="text-amber-600 font-medium">{lead.urgencyScore}/10</span>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {lead.researchedAt ? (
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-teal-50 text-teal-700">
                            Researched
                          </span>
                        ) : (
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-stone-100 text-stone-400">
                            Queued
                          </span>
                        )}
                        <form
                          action={async () => {
                            "use server";
                            await runResearchAction(lead.id);
                          }}
                        >
                          <PendingSubmitButton
                            idleLabel={lead.researchedAt ? "Re-run" : "Research"}
                            pendingLabel="Queuing..."
                          />
                        </form>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-stone-400 whitespace-nowrap text-xs">
                      {formatDate(lead.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/internal/leads/${lead.id}`}
                        className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-medium"
                      >
                        View
                        <ExternalLink size={11} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
              <div className="px-4 py-3 border-t border-[#F0EEE9] bg-[#FCFBF8] flex items-center justify-between">
                <span className="text-xs text-stone-500">Selected leads</span>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <PendingSubmitButton
                    idleLabel="Research Selected"
                    pendingLabel="Queuing selected..."
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-60"
                  />

                  <button
                    type="submit"
                    formAction={runOutboundBatchAction}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors"
                  >
                    Queue Calls Selected
                  </button>

                  {activeOutreachCampaigns.length > 0 ? (
                    <>
                      <select
                        name="sequenceData"
                        defaultValue={`${activeOutreachCampaigns[0].id}|${activeOutreachCampaigns[0].channel}`}
                        className="text-xs text-stone-700 bg-white border border-[#E8E6E1] rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
                      >
                        {activeOutreachCampaigns.map((campaign) => (
                          <option key={campaign.id} value={`${campaign.id}|${campaign.channel}`}>
                            {campaign.name} ({campaign.channel})
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        formAction={runOutreachBatchAction}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 transition-colors"
                      >
                        Queue Outreach Selected
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-stone-400">No active email/sms campaigns</span>
                  )}
                </div>
              </div>
            </form>
          </div>
        )}
      </div>

      {(page > 0 || hasMore) && (
        <div className="mt-4 flex items-center justify-between">
          <Link
            href={page > 0 ? `/internal/leads?page=${page - 1}` : "#"}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              page > 0
                ? "text-stone-700 hover:bg-white hover:border hover:border-[#E8E6E1]"
                : "text-stone-300 pointer-events-none"
            }`}
          >
            <ChevronLeft size={14} />
            Previous
          </Link>

          <span className="text-xs text-stone-400">Page {page + 1}</span>

          <Link
            href={hasMore ? `/internal/leads?page=${page + 1}` : "#"}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              hasMore
                ? "text-stone-700 hover:bg-white hover:border hover:border-[#E8E6E1]"
                : "text-stone-300 pointer-events-none"
            }`}
          >
            Next
            <ChevronRight size={14} />
          </Link>
        </div>
      )}
    </div>
  );
}
