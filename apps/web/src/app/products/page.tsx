import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ArrowRight, PhoneCall, Users } from "lucide-react";
import { QyroBrandLockup } from "@/components/brand/QyroBrand";
import BillingActions from "@/components/billing/BillingActions";

const API_URL = process.env.API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

type ProductAccess = {
  lead: boolean;
  assist: boolean;
};

export default async function ProductsPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect("/sign-in");

  const token = await getToken();
  if (!token) redirect("/sign-in");

  let productAccess: ProductAccess = { lead: false, assist: false };
  let onboardingComplete = false;
  let isMasterAdmin = false;

  try {
    const res = await fetch(`${API_URL}/api/v1/tenants/settings`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (res.ok) {
      const body = await res.json();
      isMasterAdmin = body.isMasterAdmin === true;
      onboardingComplete = body.onboardingComplete !== false;
      productAccess = body.productAccess ?? productAccess;
    }
  } catch {
    // Fall through to onboarding below on unreachable API
  }

  if (isMasterAdmin) redirect("/qx-ops");
  if (productAccess.lead && !productAccess.assist) redirect("/internal/dashboard");
  if (productAccess.assist && !productAccess.lead) redirect("/client/dashboard");
  if (!productAccess.lead && !productAccess.assist) {
    redirect(onboardingComplete ? "/onboarding" : "/onboarding");
  }

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

        <div className="grid gap-5 md:grid-cols-2">
          <Link
            href="/internal/dashboard"
            className="group rounded-3xl border border-stone-200 bg-white p-7 shadow-sm transition-all hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-[0_10px_30px_rgba(0,0,0,0.06)]"
          >
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 shadow-sm">
              <Users size={20} className="text-white" strokeWidth={2} />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">QYRO Lead</p>
                <h1 className="mt-2 text-2xl font-bold tracking-tight text-stone-900">Build and qualify pipeline</h1>
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                Live
              </span>
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
              Open Lead workspace
              <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>

          <Link
            href="/client/dashboard"
            className="group rounded-3xl border border-stone-200 bg-white p-7 shadow-sm transition-all hover:-translate-y-0.5 hover:border-stone-900 hover:shadow-[0_10px_30px_rgba(0,0,0,0.06)]"
          >
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-900 shadow-sm">
              <PhoneCall size={20} className="text-white" strokeWidth={2} />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">QYRO Assist</p>
                <h1 className="mt-2 text-2xl font-bold tracking-tight text-stone-900">Run conversations and calls</h1>
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                Live
              </span>
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
              Open Assist workspace
              <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>
        </div>

        <BillingActions productAccess={productAccess} />
      </div>
    </main>
  );
}
