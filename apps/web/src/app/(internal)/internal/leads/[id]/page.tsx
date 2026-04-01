import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Zap, ChevronRight } from "lucide-react";
import AddToCampaignForm from "./AddToCampaignForm";
import { runResearchAction } from "../actions";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

type ProspectRaw = {
  id: string;
  businessName: string;
  domain: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  niche: string | null;
  source: string;
  consentState: string;
  createdAt: string;
};

type ProspectEnriched = {
  summary: string | null;
  painPoints: string[];
  pitchAngles: string[];
  urgencyScore: number | null;
  fromCache: boolean;
  researchedAt: string;
};

type LeadDetail = ProspectRaw & {
  enriched: ProspectEnriched | null;
};

type Campaign = {
  id: string;
  name: string;
  channel: string;
  active: boolean;
};

function ConsentBadge({ state }: { state: string }) {
  const map: Record<string, { label: string; className: string }> = {
    given:   { label: "Consent given",   className: "bg-teal-50 text-teal-700" },
    denied:  { label: "Consent denied",  className: "bg-rose-50 text-rose-600" },
    revoked: { label: "Consent revoked", className: "bg-rose-50 text-rose-600" },
    unknown: { label: "Unknown",         className: "bg-stone-100 text-stone-500" },
  };
  const entry = map[state] ?? { label: state, className: "bg-stone-100 text-stone-500" };
  return (
    <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${entry.className}`}>
      {entry.label}
    </span>
  );
}

function UrgencyMeter({ score }: { score: number }) {
  const color =
    score >= 8 ? "bg-rose-500" :
    score >= 5 ? "bg-amber-500" :
                 "bg-teal-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className={`h-3 w-2.5 rounded-sm ${i < score ? color : "bg-stone-100"}`}
          />
        ))}
      </div>
      <span className="text-sm font-semibold text-stone-700 tabular-nums">
        {score}/10
      </span>
    </div>
  );
}

export default async function LeadDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { getToken } = await auth();
  const token = await getToken();

  if (!token) notFound();

  const [leadRes, campaignsRes] = await Promise.all([
    fetch(`${API_URL}/api/leads/${params.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }),
    fetch(`${API_URL}/api/campaigns?limit=50`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }),
  ]);

  if (!leadRes.ok) notFound();

  const { data: lead }: { data: LeadDetail } = await leadRes.json();
  const campaignsData = campaignsRes.ok ? await campaignsRes.json() : { data: [] };
  const activeCampaigns: Campaign[] = (campaignsData.data ?? []).filter(
    (c: Campaign) => c.active,
  );

  const enriched = lead.enriched;
  const painPoints: string[] = Array.isArray(enriched?.painPoints)
    ? (enriched.painPoints as string[])
    : [];
  const pitchAngles: string[] = Array.isArray(enriched?.pitchAngles)
    ? (enriched.pitchAngles as string[])
    : [];

  return (
    <div className="p-8 max-w-3xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-stone-400 mb-6">
        <Link href="/internal/dashboard" className="hover:text-stone-600 transition-colors">
          Dashboard
        </Link>
        <ChevronRight size={12} className="text-stone-300" />
        <Link href="/internal/leads" className="hover:text-stone-600 transition-colors">
          Leads
        </Link>
        <ChevronRight size={12} className="text-stone-300" />
        <span className="text-stone-600 truncate max-w-[180px]">{lead.businessName}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">
            {lead.businessName}
          </h1>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {lead.domain && (
              <a
                href={`https://${lead.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-stone-400 font-mono hover:text-amber-600 transition-colors"
              >
                {lead.domain}
                <ExternalLink size={11} />
              </a>
            )}
            <ConsentBadge state={lead.consentState} />
          </div>
        </div>

        <AddToCampaignForm leadId={lead.id} campaigns={activeCampaigns} />
      </div>

      {/* Meta grid */}
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Niche",  value: lead.niche  ?? "—" },
          { label: "Source", value: lead.source },
          { label: "Phone",  value: lead.phone  ?? "—" },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="bg-white border border-[#E8E6E1] rounded-[12px] p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]"
          >
            <p className="text-[10px] text-stone-400 font-medium uppercase tracking-wide mb-1">
              {label}
            </p>
            <p className="text-sm text-stone-700 font-medium">{value}</p>
          </div>
        ))}
      </div>

      {/* Research section */}
      {enriched ? (
        <div className="mt-5 space-y-4">
          {/* Urgency */}
          <div className="bg-white border border-[#E8E6E1] rounded-[14px] p-5 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            <p className="text-[10px] text-stone-400 font-medium uppercase tracking-wide mb-3">
              Urgency score
            </p>
            {enriched.urgencyScore != null ? (
              <UrgencyMeter score={enriched.urgencyScore} />
            ) : (
              <p className="text-sm text-stone-400">Not scored</p>
            )}
          </div>

          {/* Summary */}
          {enriched.summary && (
            <div className="bg-white border border-[#E8E6E1] rounded-[14px] p-5 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
              <p className="text-[10px] text-stone-400 font-medium uppercase tracking-wide mb-3">
                Research summary
              </p>
              <p className="text-sm text-stone-700 leading-relaxed">
                {enriched.summary}
              </p>
              {enriched.fromCache && (
                <p className="text-[11px] text-stone-300 mt-3">From cache</p>
              )}
            </div>
          )}

          {/* Pain points */}
          {painPoints.length > 0 && (
            <div className="bg-white border border-[#E8E6E1] rounded-[14px] p-5 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
              <p className="text-[10px] text-stone-400 font-medium uppercase tracking-wide mb-3">
                Pain points
              </p>
              <div className="flex flex-wrap gap-2">
                {painPoints.map((pt, i) => (
                  <span
                    key={i}
                    className="text-xs font-medium px-3 py-1.5 rounded-full bg-rose-50 text-rose-700"
                  >
                    {pt}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Pitch angles */}
          {pitchAngles.length > 0 && (
            <div className="bg-white border border-[#E8E6E1] rounded-[14px] p-5 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
              <p className="text-[10px] text-stone-400 font-medium uppercase tracking-wide mb-3">
                Pitch angles
              </p>
              <div className="flex flex-wrap gap-2">
                {pitchAngles.map((angle, i) => (
                  <span
                    key={i}
                    className="text-xs font-medium px-3 py-1.5 rounded-full bg-amber-50 text-amber-700"
                  >
                    {angle}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* No research yet — offer to run it */
        <div className="mt-5 bg-white border border-[#E8E6E1] rounded-[14px] p-8 shadow-[0_1px_4px_rgba(0,0,0,0.04)] text-center">
          <Zap size={20} className="text-amber-400 mx-auto mb-2" />
          <p className="text-sm font-medium text-stone-700">No research yet</p>
          <p className="text-xs text-stone-400 mt-1 mb-4">
            Run the research agent to populate insights.
          </p>
          <form
            action={async () => {
              "use server";
              await runResearchAction(params.id);
            }}
          >
            <button
              type="submit"
              className="text-sm font-medium px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 transition-colors"
            >
              Run research
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
