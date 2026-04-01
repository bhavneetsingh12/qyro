import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const PAGE_SIZE = 25;

type Lead = {
  id: string;
  businessName: string;
  niche: string | null;
  domain: string | null;
  source: string;
  consentState: string;
  deduped: boolean;
  createdAt: string;
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
    apollo:        { label: "Apollo",     className: "bg-violet-50 text-violet-700" },
    places_api:    { label: "Places",     className: "bg-sky-50 text-sky-700" },
    inbound_form:  { label: "Manual",     className: "bg-stone-100 text-stone-600" },
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

  let leads: Lead[] = [];
  let fetchError = false;

  if (token) {
    try {
      const res = await fetch(
        `${API_URL}/api/leads?limit=${PAGE_SIZE}&offset=${offset}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }
      );
      if (res.ok) {
        const data = await res.json();
        leads = data.data ?? [];
      } else {
        fetchError = true;
      }
    } catch {
      fetchError = true;
    }
  }

  const hasMore = leads.length === PAGE_SIZE;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Leads</h1>
          <p className="text-sm text-stone-400 mt-0.5">
            {page === 0 ? "Most recent prospects" : `Page ${page + 1}`}
          </p>
        </div>
      </div>

      {/* Table card */}
      <div className="mt-6 bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
        {fetchError ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-rose-500 font-medium">Could not reach API</p>
            <p className="text-xs text-stone-400 mt-1">Make sure the API server is running on port 3001.</p>
          </div>
        ) : leads.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-stone-500 font-medium">No leads found</p>
            <p className="text-xs text-stone-400 mt-1">
              {page > 0 ? "You've reached the end of the list." : "Run lead discovery to populate the inbox."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[#F0EEE9] bg-[#FAFAF8]">
                <th className="text-left px-5 py-3 text-xs font-medium text-stone-400 uppercase tracking-wide">
                  Business
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-400 uppercase tracking-wide">
                  Niche
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-400 uppercase tracking-wide">
                  Domain
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
                <tr
                  key={lead.id}
                  className="hover:bg-[#FAFAF8] transition-colors group"
                >
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
                  <td className="px-4 py-3">
                    {lead.domain ? (
                      <span className="text-stone-500 font-mono text-xs">{lead.domain}</span>
                    ) : (
                      <span className="text-stone-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-stone-300 tabular-nums">—</td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-stone-100 text-stone-400">
                      Not researched
                    </span>
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
        )}
      </div>

      {/* Pagination */}
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
