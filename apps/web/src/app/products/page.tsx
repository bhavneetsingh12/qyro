import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ArrowRight, PhoneCall, Users } from "lucide-react";
import { QyroBrandLockup } from "@/components/brand/QyroBrand";
import BillingActions from "@/components/billing/BillingActions";
import { getPreferredWorkspace, normalizeProductAccess, type ProductAccess } from "@/lib/workspace";

const API_URL = process.env.API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

export default async function ProductsPage({
  searchParams,
}: {
  searchParams?: { upgrade?: string };
}) {
  const { userId, getToken } = await auth();
  if (!userId) redirect("/sign-in");

  const token = await getToken();
  if (!token) redirect("/sign-in");

  let productAccess: ProductAccess = { lead: false, assist: false };
  let onboardingComplete = false;
  let isMasterAdmin = false;
  let tenantType = "";
  const upgradeIntent = String(searchParams?.upgrade ?? "").trim().toLowerCase();
  const forceHub = upgradeIntent === "lead" || upgradeIntent === "assist" || upgradeIntent === "bundle";

  try {
    const res = await fetch(`${API_URL}/api/v1/tenants/settings`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (res.ok) {
      const body = await res.json();
      isMasterAdmin = body.isMasterAdmin === true;
      onboardingComplete = body.onboardingComplete !== false;
      productAccess = normalizeProductAccess(body.productAccess);
      tenantType = String(body.tenantType ?? "").trim();
    }
  } catch {
    // Fall through to onboarding below on unreachable API
  }

  if (isMasterAdmin) redirect("/qx-ops");
  const preferredWorkspace = getPreferredWorkspace({ productAccess, tenantType });
  if (!forceHub && preferredWorkspace) redirect(preferredWorkspace);
  if (!productAccess.lead && !productAccess.assist) {
    redirect(onboardingComplete ? "/products?upgrade=bundle" : "/onboarding");
  }

  const highlightLead = forceHub && (!productAccess.lead || upgradeIntent === "lead" || upgradeIntent === "bundle");
  const highlightAssist = forceHub && (!productAccess.assist || upgradeIntent === "assist" || upgradeIntent === "bundle");
  const leadHref = productAccess.lead ? "/internal/dashboard" : "/lead";
  const assistHref = productAccess.assist ? "/client/dashboard" : "/assist";

  return (
    <main className="min-h-screen bg-[#F7F6F2] px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <QyroBrandLockup surface="core" align="left" subtitle="Choose your workspace" />
            <p className="mt-3 max-w-2xl text-sm text-stone-500">
              QYRO Lead finds and qualifies prospects. QYRO Assist handles conversations, outbound calls,
              and follow-up. Use both together to move leads from discovery to warm handoff.
            </p>
          </div>
          <Link
            href="/"
            className="text-xs font-medium text-stone-500 transition-colors hover:text-stone-900"
          >
            Back to qyro.us
          </Link>
        </div>

        {forceHub && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
            <p className="text-sm font-semibold text-amber-800">Add another QYRO product</p>
            <p className="mt-1 text-sm text-amber-700">
              Unlock the second workspace to run the full lead-to-call workflow from one account.
            </p>
          </div>
        )}

        <div className="grid gap-5 md:grid-cols-2">
          <Link
            href={leadHref}
            className={`group rounded-3xl bg-white p-7 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(0,0,0,0.06)] ${
              highlightLead ? "border-2 border-amber-400" : "border border-stone-200 hover:border-amber-400"
            }`}
          >
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 shadow-sm">
              <Users size={20} className="text-white" strokeWidth={2} />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">QYRO Lead</p>
                <h1 className="mt-2 text-2xl font-bold tracking-tight text-stone-900">Build and qualify pipeline</h1>
              </div>
              {productAccess.lead ? (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                  Active
                </span>
              ) : (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                  Available
                </span>
              )}
            </div>
            <p className="mt-4 text-sm leading-relaxed text-stone-500">
              Discover prospects, run research, manage outreach approvals, and push selected leads into the outbound call pipeline.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-stone-600">
              <li>Lead discovery from public business sources</li>
              <li>AI research and urgency scoring</li>
              <li>Campaign drafting and approval workflows</li>
            </ul>
            <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-stone-900">
              {productAccess.lead ? "Open Lead workspace" : "See Lead details"}
              <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>

          <Link
            href={assistHref}
            className={`group rounded-3xl bg-white p-7 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(0,0,0,0.06)] ${
              highlightAssist ? "border-2 border-stone-900" : "border border-stone-200 hover:border-stone-900"
            }`}
          >
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-900 shadow-sm">
              <PhoneCall size={20} className="text-white" strokeWidth={2} />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">QYRO Assist</p>
                <h1 className="mt-2 text-2xl font-bold tracking-tight text-stone-900">Run conversations and calls</h1>
              </div>
              {productAccess.assist ? (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                  Active
                </span>
              ) : (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                  Available
                </span>
              )}
            </div>
            <p className="mt-4 text-sm leading-relaxed text-stone-500">
              Review conversations, manage outbound call operations, track escalations, and warm prospects before human follow-up.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-stone-600">
              <li>Outbound calling and queue controls</li>
              <li>Conversation history, transcripts, and bookings</li>
              <li>Warm-lead follow-up and handoff visibility</li>
            </ul>
            <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-stone-900">
              {productAccess.assist ? "Open Assist workspace" : "See Assist details"}
              <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>
        </div>

        <BillingActions productAccess={productAccess} />
      </div>
    </main>
  );
}
