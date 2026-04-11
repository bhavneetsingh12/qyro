import Link from "next/link";
import { ArrowRight, PhoneCall, MessageSquare, Calendar, Users, Zap, Shield, CheckCircle2 } from "lucide-react";
import { QyroMark } from "@/components/brand/QyroBrand";
import { ASSIST_PRICING } from "@/config/pricing";

export const metadata = {
  title: "QYRO Assist — AI Voice Assistant for Local Businesses",
  description:
    "Handle inbound calls, book appointments, answer FAQs, and follow up on missed calls — automatically. Works with your existing business number.",
};

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Connect your number",
    body: "Forward your existing landline, VoIP, or mobile number to QYRO. No porting, no changes for your customers — they call the same number they always have.",
  },
  {
    step: "2",
    title: "Configure your assistant",
    body: "Tell QYRO about your business: your services, FAQ answers, booking calendar, and escalation rules. Takes about 10 minutes.",
  },
  {
    step: "3",
    title: "QYRO handles it",
    body: "Every call gets answered instantly. Bookings get logged. Missed calls get an automatic SMS follow-up. You get a full transcript of every conversation.",
  },
];

const WHO_ITS_FOR = [
  { label: "Home Services", detail: "Plumbers, HVAC, landscaping, cleaning companies" },
  { label: "Local Healthcare", detail: "Dental, chiropractic, optometry, therapy practices" },
  { label: "Salons & Spas", detail: "Hair, nails, massage, aesthetics" },
  { label: "Fitness Studios", detail: "Gyms, yoga, pilates, martial arts" },
  { label: "Legal & Financial", detail: "Solo practitioners and boutique firms" },
  { label: "Real Estate", detail: "Agents, property managers, brokerages" },
];

const FEATURES = [
  {
    icon: PhoneCall,
    title: "AI inbound call handling",
    body: "Every call answered in under 2 seconds, 24/7. The AI introduces itself as your assistant and handles the conversation naturally.",
  },
  {
    icon: Calendar,
    title: "Appointment booking",
    body: "Syncs with your calendar (Google Calendar, Cal.com). Checks availability and books appointments in real time during the call.",
  },
  {
    icon: MessageSquare,
    title: "Missed-call SMS follow-up",
    body: "If a call is missed or goes to voicemail, QYRO sends an automatic SMS within seconds to re-engage the caller.",
  },
  {
    icon: Users,
    title: "Human escalation",
    body: "The AI knows when to hand off. Set escalation rules and get notified immediately when a caller needs a real person.",
  },
  {
    icon: Zap,
    title: "Website chat widget",
    body: "Add a chat widget to your site so visitors can get instant answers without picking up the phone.",
  },
  {
    icon: Shield,
    title: "Call transcripts & recordings",
    body: "Every conversation is transcribed and stored. Review what callers asked, catch missed opportunities, and improve over time.",
  },
];

const FAQ = [
  {
    q: "Do I need to port my number?",
    a: "No. You forward calls to QYRO using a simple call-forwarding rule in your phone settings or carrier dashboard. Your customers keep calling the same number they always have.",
  },
  {
    q: "What happens when the AI can't handle a call?",
    a: "You configure escalation rules: the AI can transfer to your cell, send you an SMS alert, or take a message — whatever workflow fits your business.",
  },
  {
    q: "Can I customize what the AI says?",
    a: "Yes. You set your business name, services, FAQ answers, booking instructions, and tone during onboarding. Pro plan includes a custom voice persona.",
  },
  {
    q: "Does it work with my existing calendar?",
    a: "QYRO currently integrates with Google Calendar and Cal.com. Additional calendar integrations are on the roadmap.",
  },
  {
    q: "What counts as an AI-handled minute?",
    a: "Any minute where the AI is actively on a call — inbound, outbound follow-up, or transfer handling. Minutes are counted per plan; overages are billed at $0.35/min.",
  },
];

export default function AssistPage() {
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
            <Link href="/assist" className="text-sm font-medium text-stone-900 transition-colors">QYRO Assist</Link>
            <Link href="/lead" className="text-sm font-medium text-stone-500 hover:text-stone-900 transition-colors">QYRO Lead</Link>
            <a href="#pricing" className="text-sm font-medium text-stone-500 hover:text-stone-900 transition-colors">Pricing</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/contact" className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors">Book a demo</Link>
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
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-stone-600 bg-stone-100 border border-stone-200 px-3 py-1.5 rounded-full mb-6">
            <PhoneCall size={11} strokeWidth={2.5} />
            Available now
          </div>
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight text-stone-900 leading-[1.05]">
            Your AI front desk.
            <br />
            <span className="text-amber-500">Always on.</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-stone-500 max-w-2xl mx-auto leading-relaxed">
            QYRO Assist handles inbound calls, books appointments, answers questions, and follows up on missed calls — automatically, using your existing business number.
          </p>
          <p className="mt-3 text-sm text-stone-400 max-w-xl mx-auto">
            No number porting. No hardware. Set up in under 15 minutes.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-xl bg-stone-900 text-white hover:bg-stone-800 transition-colors shadow-sm"
            >
              Get started
              <ArrowRight size={14} strokeWidth={2.5} />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-50 transition-colors"
            >
              Book a demo
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 px-4 sm:px-6 bg-white border-y border-stone-200">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 text-center mb-10">How it works</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map(({ step, title, body }) => (
              <div key={step} className="flex flex-col">
                <div className="h-9 w-9 rounded-full bg-amber-100 flex items-center justify-center mb-4">
                  <span className="text-sm font-bold text-amber-700">{step}</span>
                </div>
                <h3 className="text-base font-bold text-stone-900 mb-2">{title}</h3>
                <p className="text-sm text-stone-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 text-center mb-2">Features</p>
          <h2 className="text-3xl font-bold text-stone-900 text-center mb-12">Everything your front desk needs</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-stone-200 bg-white p-6">
                <div className="h-9 w-9 rounded-xl bg-stone-100 flex items-center justify-center mb-4">
                  <Icon size={16} className="text-stone-700" strokeWidth={1.75} />
                </div>
                <h3 className="text-sm font-bold text-stone-900 mb-1.5">{title}</h3>
                <p className="text-sm text-stone-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="py-16 px-4 sm:px-6 bg-stone-50 border-y border-stone-200">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 text-center mb-10">Who it&apos;s for</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {WHO_ITS_FOR.map(({ label, detail }) => (
              <div key={label} className="rounded-xl border border-stone-200 bg-white p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <CheckCircle2 size={13} className="text-amber-500 shrink-0" strokeWidth={2} />
                  <p className="text-sm font-semibold text-stone-900">{label}</p>
                </div>
                <p className="text-xs text-stone-500 pl-5">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-4 sm:px-6 scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 text-center mb-2">Pricing</p>
          <h2 className="text-3xl font-bold text-stone-900 text-center mb-3">Simple, transparent pricing</h2>
          <p className="text-stone-500 text-center text-sm mb-12">No setup fees. Bring your own number. Cancel anytime.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {ASSIST_PRICING.tiers.map((tier) => (
              <Link
                key={tier.key}
                href={`/sign-up?plan=assist-${tier.key}`}
                className={`rounded-2xl p-7 flex flex-col relative cursor-pointer transition-all hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] ${
                  tier.popular
                    ? "border-2 border-amber-400 bg-white shadow-sm hover:border-amber-500"
                    : "border border-stone-200 bg-[#FAFAF8] hover:border-stone-400"
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
                <ul className="space-y-2.5 flex-1 mb-5">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-stone-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0 mt-1.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <div
                  className={`inline-flex items-center justify-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors ${
                    tier.popular
                      ? "bg-amber-500 text-white hover:bg-amber-600 shadow-sm"
                      : "border border-stone-900 text-stone-900 hover:bg-stone-900 hover:text-white"
                  }`}
                >
                  Get started with {tier.label}
                  <ArrowRight size={13} strokeWidth={2.5} />
                </div>
              </Link>
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
              Need a custom plan?{" "}
              <Link href="/contact" className="text-amber-600 hover:underline">Book a demo</Link>
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 px-4 sm:px-6 bg-white border-t border-stone-200">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 text-center mb-10">FAQ</p>
          <div className="space-y-6">
            {FAQ.map(({ q, a }) => (
              <div key={q} className="border-b border-stone-100 pb-6 last:border-0">
                <p className="text-sm font-bold text-stone-900 mb-2">{q}</p>
                <p className="text-sm text-stone-500 leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-4 sm:px-6">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-stone-900">Ready to stop missing calls?</h2>
          <p className="mt-4 text-stone-500 text-base">
            No setup fees. No long-term contracts. Cancel anytime.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 text-sm font-semibold px-7 py-3.5 rounded-xl bg-amber-500 text-white hover:bg-amber-600 transition-colors shadow-sm"
            >
              Get started
              <ArrowRight size={14} strokeWidth={2.5} />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 text-sm font-semibold px-7 py-3.5 rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-50 transition-colors"
            >
              Talk to sales
            </Link>
          </div>
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
