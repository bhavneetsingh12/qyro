import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ArrowRight, PhoneCall, Users, BarChart3, Zap, Shield, Clock } from "lucide-react";
import { QyroMark } from "@/components/brand/QyroBrand";
import { ASSIST_PRICING } from "@/config/pricing";

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
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/assist" className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors">QYRO Assist</Link>
            <Link href="/lead" className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors">QYRO Lead</Link>
            <a href="#pricing" className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors">Pricing</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/sign-in"
              className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
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
          <p className="mt-3 text-sm text-stone-400 max-w-xl mx-auto">
            Works with your existing business number — no porting, no changes, customers call the same number they always have.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/sign-up"
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
      <section id="products" className="py-16 px-4 sm:px-6 scroll-mt-20">
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
                {[
                  "Bring your own number — connect any existing landline, VoIP, or mobile number in minutes",
                  "Automated appointment booking",
                  "Call transcripts & recordings",
                  "Human escalation controls",
                ].map((f) => (
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

      {/* Solutions */}
      <section id="solutions" className="py-14 px-4 sm:px-6 scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 text-center mb-8">Solutions</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-stone-200 bg-white p-6">
              <h3 className="text-sm font-bold text-stone-900">Home Services</h3>
              <p className="text-sm text-stone-500 mt-2">Capture missed calls, book jobs faster, and keep your schedule full.</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-6">
              <h3 className="text-sm font-bold text-stone-900">Local Healthcare</h3>
              <p className="text-sm text-stone-500 mt-2">Handle routine call volume and booking requests with compliant workflows.</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-6">
              <h3 className="text-sm font-bold text-stone-900">Agencies</h3>
              <p className="text-sm text-stone-500 mt-2">Scale lead operations and client response times without adding headcount.</p>
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

      {/* Pricing */}
      <section id="pricing" className="py-20 px-4 sm:px-6 scroll-mt-20 bg-white border-y border-stone-200">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 text-center mb-2">Pricing</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-stone-900 text-center mb-3">Simple, transparent pricing</h2>
          <p className="text-stone-500 text-center text-sm mb-12">QYRO Assist plans for local businesses. No setup fees. Bring your own number.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {ASSIST_PRICING.tiers.map((tier) => (
              <div
                key={tier.key}
                className={`rounded-2xl p-7 flex flex-col relative ${
                  tier.popular
                    ? "border-2 border-amber-400 bg-white shadow-sm"
                    : "border border-stone-200 bg-[#FAFAF8]"
                }`}
              >
                {tier.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="text-xs font-semibold bg-amber-400 text-white px-3 py-1 rounded-full">Most popular</span>
                  </div>
                )}
                <p className={`text-xs font-semibold uppercase tracking-widest mb-3 ${tier.popular ? "text-amber-600" : "text-stone-400"}`}>
                  {tier.label}
                </p>
                <div className="flex items-end gap-1 mb-1">
                  <span className="text-4xl font-bold text-stone-900">${tier.price}</span>
                  <span className="text-sm text-stone-400 mb-1">/month</span>
                </div>
                <p className="text-sm text-stone-500 mb-5">{tier.tagline}</p>
                <ul className="space-y-2.5 flex-1 mb-7">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-stone-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0 mt-1.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/sign-up"
                  className={`inline-flex items-center justify-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors ${
                    tier.popular
                      ? "bg-amber-500 text-white hover:bg-amber-600 shadow-sm"
                      : "border border-stone-900 text-stone-900 hover:bg-stone-900 hover:text-white"
                  }`}
                >
                  Get started
                  <ArrowRight size={13} strokeWidth={2.5} />
                </Link>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center space-y-1.5">
            <p className="text-xs text-stone-400">
              Overage: <span className="font-medium text-stone-500">${ASSIST_PRICING.overagePerMin}/min</span> beyond included minutes.
            </p>
            <p className="text-xs text-stone-400">
              Your existing carrier costs apply separately. QYRO charges only for AI-handled call time.
            </p>
            <p className="text-xs text-stone-400 mt-3">
              Need a custom plan or want to see it in action?{" "}
              <Link href="/contact" className="text-amber-600 hover:underline">Book a demo</Link>
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-4 sm:px-6">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-stone-900">Ready to get started?</h2>
          <p className="mt-4 text-stone-500 text-base">
            Create your account in seconds. No credit card required to sign up.
          </p>
          <Link
            href="/sign-up"
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
            <Link href="/assist" className="hover:text-stone-700 transition-colors">QYRO Assist</Link>
            <Link href="/lead" className="hover:text-stone-700 transition-colors">QYRO Lead</Link>
            <Link href="/sign-in" className="hover:text-stone-700 transition-colors">Sign in</Link>
            <Link href="/contact" className="hover:text-stone-700 transition-colors">Contact</Link>
            <Link href="/terms" className="hover:text-stone-700 transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-stone-700 transition-colors">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
