"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { ArrowRight, PhoneCall, Users, CheckCircle2 } from "lucide-react";
import { QyroMark } from "@/components/brand/QyroBrand";
import { LEAD_PRICING } from "@/config/pricing";

const LEAD_FEATURES = [
  "Automated lead discovery from public business datasets",
  "AI-powered research and urgency scoring",
  "Campaign drafting with approval workflow",
  "Outbound call handoff into QYRO Assist",
  "CRM-ready export",
  "Multi-campaign management",
];

export default function LeadPage() {
  const { userId } = useAuth();
  const leadUpgradeHref = "/products?upgrade=lead#billing";
  const leadStarterHref = userId ? leadUpgradeHref : "/sign-up?plan=lead-starter";
  const leadGrowthHref = userId ? leadUpgradeHref : "/sign-up?plan=lead-growth";

  return (
    <div className="min-h-screen bg-[#FAFAF8] text-stone-900">
      <header className="fixed top-0 inset-x-0 z-50 border-b border-stone-200/60 bg-[#FAFAF8]/90 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <QyroMark surface="core" />
            <span className="text-sm font-bold tracking-tight text-stone-900">QYRO</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/assist" className="text-sm font-medium text-stone-500 hover:text-stone-900 transition-colors">QYRO Assist</Link>
            <Link href="/lead" className="text-sm font-medium text-stone-900 transition-colors">QYRO Lead</Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href={leadStarterHref}
              className="text-sm font-semibold px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 transition-colors"
            >
              Start QYRO Lead
            </Link>
          </div>
        </div>
      </header>

      <section className="pt-32 pb-20 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full mb-6">
            <Users size={11} strokeWidth={2.5} />
            Available now
          </div>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-stone-900 leading-[1.05]">
            AI-powered
            <br />
            <span className="text-amber-500">lead engine.</span>
          </h1>
          <p className="mt-6 text-lg text-stone-500 max-w-2xl mx-auto leading-relaxed">
            QYRO Lead finds businesses in your target market, researches them, drafts outreach, and pushes selected prospects into Assist so your outbound calling pipeline stays warm and moving.
          </p>
          <p className="mt-3 text-sm text-stone-400">
            Built to work alongside QYRO Assist for one connected lead-to-conversation workflow.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href={leadStarterHref}
              className="inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-xl bg-amber-500 text-white hover:bg-amber-600 transition-colors shadow-sm"
            >
              Start with Lead
              <ArrowRight size={14} strokeWidth={2.5} />
            </Link>
            <Link
              href="/assist"
              className="inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-50 transition-colors"
            >
              See QYRO Assist
            </Link>
          </div>
        </div>
      </section>

      <section className="py-16 px-4 sm:px-6 bg-white border-y border-stone-200">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 text-center mb-10">What you get</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {LEAD_FEATURES.map((feature) => (
              <div key={feature} className="flex items-center gap-3 rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
                <CheckCircle2 size={14} className="text-amber-500 shrink-0" strokeWidth={2.5} />
                <span className="text-sm text-stone-600">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 text-center mb-2">Pricing</p>
          <h2 className="text-3xl font-bold text-stone-900 text-center mb-3">Launch pricing</h2>
          <p className="text-stone-500 text-center text-sm mb-12">
            Starter and Growth are available now. Pro is available by guided setup.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {LEAD_PRICING.tiers.map((tier) => {
              const isDirectCheckout = tier.key === "starter" || tier.key === "growth";
              return (
                <div key={tier.key} className={`rounded-2xl p-7 flex flex-col ${tier.key === "growth" ? "border-2 border-amber-400 bg-white shadow-sm" : "border border-stone-200 bg-stone-50"}`}>
                  <p className={`text-xs font-semibold uppercase tracking-widest mb-3 ${tier.key === "growth" ? "text-amber-600" : "text-stone-400"}`}>
                    {tier.label}
                  </p>
                  <div className="flex items-end gap-1 mb-1">
                    <span className="text-4xl font-bold text-stone-900">${tier.price}</span>
                    <span className="text-sm text-stone-400 mb-1">/month</span>
                  </div>
                  <p className="text-sm text-stone-500 mb-5">{tier.tagline}</p>
                  <ul className="space-y-2.5 flex-1 mb-7">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm text-stone-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0 mt-1.5" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  {isDirectCheckout ? (
                    <Link
                      href={userId ? leadUpgradeHref : `/sign-up?plan=lead-${tier.key}`}
                      className={`inline-flex items-center justify-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors ${
                        tier.key === "growth"
                          ? "bg-amber-500 text-white hover:bg-amber-600"
                          : "border border-stone-900 text-stone-900 hover:bg-stone-900 hover:text-white"
                      }`}
                    >
                      Get started
                      <ArrowRight size={13} strokeWidth={2.5} />
                    </Link>
                  ) : (
                    <Link
                      href="/contact"
                      className="inline-flex items-center justify-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl border border-stone-300 text-stone-700 hover:bg-white transition-colors"
                    >
                      Talk to sales
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-16 px-4 sm:px-6 bg-stone-900">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">Complete workflow</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">Use Lead and Assist together</h2>
          <p className="text-stone-400 text-sm mb-8">
            Generate pipeline in Lead, then hand selected prospects into Assist for outbound calls, warming, and follow-up before you step in.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href={leadGrowthHref}
              className="inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-xl bg-amber-500 text-white hover:bg-amber-600 transition-colors shadow-sm"
            >
              Launch QYRO Lead
              <ArrowRight size={14} strokeWidth={2.5} />
            </Link>
            <Link
              href="/assist"
              className="inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-xl border border-stone-600 text-white hover:bg-stone-800 transition-colors"
            >
              <PhoneCall size={14} strokeWidth={2.5} />
              Explore Assist
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
