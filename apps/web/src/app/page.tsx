import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ArrowRight, PhoneCall, Users, BarChart3, Zap, Shield, Clock } from "lucide-react";
import { QyroMark } from "@/components/brand/QyroBrand";

export default async function RootPage() {
  const { userId } = await auth();
  if (userId) redirect("/products");

  return (
    <div className="min-h-screen bg-[#FAFAF8] text-stone-900">
      {/* Nav */}
      <header className="fixed top-0 inset-x-0 z-50 border-b border-stone-200/60 bg-[#FAFAF8]/90 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <QyroMark surface="core" />
            <span className="text-sm font-bold tracking-tight text-stone-900">QYRO</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/sign-in"
              className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/sign-in"
              className="text-sm font-semibold px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 transition-colors"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full mb-6">
            <Zap size={11} strokeWidth={2.5} />
            AI-powered for service businesses
          </div>
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight text-stone-900 leading-[1.05]">
            Grow your business
            <br />
            <span className="text-amber-500">on autopilot.</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-stone-500 max-w-2xl mx-auto leading-relaxed">
            QYRO combines an intelligent lead engine with an AI client assistant — so you can find more customers and serve them better, without the overhead.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-xl bg-stone-900 text-white hover:bg-stone-800 transition-colors shadow-sm"
            >
              Start for free
              <ArrowRight size={14} strokeWidth={2.5} />
            </Link>
            <span className="text-xs text-stone-400">No credit card required to sign up</span>
          </div>
        </div>
      </section>

      {/* Product cards */}
      <section className="py-16 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 text-center mb-8">Two products. One platform.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Lead */}
            <div className="rounded-2xl border border-stone-200 bg-white p-8 flex flex-col">
              <div className="h-10 w-10 rounded-xl bg-amber-500 flex items-center justify-center mb-5 shadow-sm">
                <Users size={18} className="text-white" strokeWidth={2} />
              </div>
              <h2 className="text-xl font-bold text-stone-900">QYRO Lead</h2>
              <p className="mt-2 text-sm text-stone-500 leading-relaxed flex-1">
                Automated lead sourcing from public business datasets, AI research, and campaign drafting — all with a built-in approval workflow.
              </p>
              <ul className="mt-5 space-y-2">
                {["Automated lead discovery", "AI-written outreach drafts", "Approval & review workflow", "CRM-ready export"].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-stone-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            {/* Assist */}
            <div className="rounded-2xl border border-stone-200 bg-white p-8 flex flex-col">
              <div className="h-10 w-10 rounded-xl bg-stone-900 flex items-center justify-center mb-5 shadow-sm">
                <PhoneCall size={18} className="text-white" strokeWidth={2} />
              </div>
              <h2 className="text-xl font-bold text-stone-900">QYRO Assist</h2>
              <p className="mt-2 text-sm text-stone-500 leading-relaxed flex-1">
                An AI voice agent that handles inbound and outbound calls, books appointments, answers questions, and escalates when needed.
              </p>
              <ul className="mt-5 space-y-2">
                {["AI inbound & outbound calls", "Automated appointment booking", "Call transcripts & recordings", "Human escalation controls"].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-stone-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-stone-400 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Stats / trust bar */}
      <section className="py-14 px-4 sm:px-6 border-y border-stone-200 bg-white">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
          {[
            { icon: Clock, label: "Hours saved per week", value: "20+" },
            { icon: BarChart3, label: "Avg lead pipeline growth", value: "3×" },
            { icon: Shield, label: "Built for compliance", value: "TCPA ready" },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex flex-col items-center gap-2">
              <Icon size={20} className="text-amber-500" strokeWidth={1.5} />
              <p className="text-3xl font-bold text-stone-900">{value}</p>
              <p className="text-sm text-stone-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-4 sm:px-6">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-stone-900">Ready to get started?</h2>
          <p className="mt-4 text-stone-500 text-base">
            Create your account in seconds. Choose the plan that fits your business.
          </p>
          <Link
            href="/sign-in"
            className="inline-flex items-center gap-2 mt-8 text-sm font-semibold px-7 py-3.5 rounded-xl bg-amber-500 text-white hover:bg-amber-600 transition-colors shadow-sm"
          >
            Create free account
            <ArrowRight size={14} strokeWidth={2.5} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-200 py-8 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <QyroMark surface="core" />
            <span className="text-xs text-stone-400">© 2026 QYRO</span>
          </div>
          <div className="flex items-center gap-5 text-xs text-stone-400">
            <Link href="/sign-in" className="hover:text-stone-700 transition-colors">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
