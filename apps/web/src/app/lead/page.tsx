"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Users, Lock } from "lucide-react";
import { QyroMark } from "@/components/brand/QyroBrand";
import { LEAD_PRICING } from "@/config/pricing";

const LEAD_FEATURES = [
  "Automated lead discovery from public business datasets",
  "AI-powered research and scoring",
  "Campaign drafting with approval workflow",
  "CRM-ready export",
  "Multi-campaign management",
  "Team collaboration",
];

export default function LeadPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("submitting");
    try {
      await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), product: "lead" }),
      });
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8] text-stone-900">
      {/* Nav */}
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
              href="/assist"
              className="text-sm font-semibold px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 transition-colors"
            >
              Try QYRO Assist
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full mb-6">
            <Users size={11} strokeWidth={2.5} />
            Coming soon — Phase 4
          </div>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-stone-900 leading-[1.05]">
            AI-powered
            <br />
            <span className="text-amber-500">lead engine.</span>
          </h1>
          <p className="mt-6 text-lg text-stone-500 max-w-2xl mx-auto leading-relaxed">
            QYRO Lead finds businesses in your target market, researches them, drafts outreach, and manages your campaign pipeline — with a built-in approval workflow so you stay in control.
          </p>
          <p className="mt-3 text-sm text-stone-400">
            Currently internal-only. Join the waitlist to get early access.
          </p>

          {/* Waitlist form */}
          <div className="mt-10 max-w-md mx-auto">
            {status === "done" ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-800">
                You&apos;re on the list. We&apos;ll reach out when QYRO Lead opens to new accounts.
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="flex-1 text-sm px-4 py-2.5 rounded-xl border border-stone-200 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent placeholder:text-stone-400"
                />
                <button
                  type="submit"
                  disabled={status === "submitting"}
                  className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl bg-amber-500 text-white hover:bg-amber-600 transition-colors shadow-sm disabled:opacity-60"
                >
                  Join waitlist
                  <ArrowRight size={13} strokeWidth={2.5} />
                </button>
              </form>
            )}
            {status === "error" && (
              <p className="mt-2 text-xs text-red-500 text-center">Something went wrong. Try again or email us at support@qyro.us.</p>
            )}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 px-4 sm:px-6 bg-white border-y border-stone-200">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 text-center mb-10">What&apos;s coming</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {LEAD_FEATURES.map((f) => (
              <div key={f} className="flex items-center gap-3 rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                <span className="text-sm text-stone-600">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing preview — locked/greyed */}
      <section className="py-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 text-center mb-2">Pricing</p>
          <h2 className="text-3xl font-bold text-stone-900 text-center mb-3">Planned pricing</h2>
          <p className="text-stone-400 text-center text-sm mb-12">Indicative only — subject to change before launch.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {LEAD_PRICING.tiers.map((tier) => (
              <div key={tier.key} className="rounded-2xl border border-stone-200 bg-stone-50 p-7 flex flex-col opacity-60">
                <div className="flex items-start justify-between mb-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">{tier.label}</p>
                  <Lock size={13} className="text-stone-300" strokeWidth={2} />
                </div>
                <div className="flex items-end gap-1 mb-1">
                  <span className="text-4xl font-bold text-stone-400">${tier.price}</span>
                  <span className="text-sm text-stone-400 mb-1">/month</span>
                </div>
                <p className="text-sm text-stone-400 mb-5">{tier.tagline}</p>
                <ul className="space-y-2.5 flex-1 mb-7">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-stone-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-stone-300 shrink-0 mt-1.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="inline-flex items-center justify-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl border border-stone-200 text-stone-400 cursor-not-allowed">
                  Not yet available
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA to Assist */}
      <section className="py-16 px-4 sm:px-6 bg-stone-900">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">Available now</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">Looking to automate client calls today?</h2>
          <p className="text-stone-400 text-sm mb-8">
            QYRO Assist is live now — AI inbound call handling, appointment booking, and missed-call follow-up for local businesses.
          </p>
          <Link
            href="/assist"
            className="inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-xl bg-amber-500 text-white hover:bg-amber-600 transition-colors shadow-sm"
          >
            See QYRO Assist
            <ArrowRight size={14} strokeWidth={2.5} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-200 py-8 px-4 sm:px-6 bg-[#FAFAF8]">
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
