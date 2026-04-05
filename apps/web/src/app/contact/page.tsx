import Link from "next/link";
import { QyroMark } from "@/components/brand/QyroBrand";
import { Mail } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact — QYRO",
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] text-stone-900">
      <header className="border-b border-stone-200 py-4 px-6">
        <Link href="/" className="inline-flex items-center gap-2">
          <QyroMark surface="core" />
          <span className="text-sm font-bold tracking-tight">QYRO</span>
        </Link>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-20 text-center">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-amber-50 border border-amber-200 mb-6 mx-auto">
          <Mail size={24} className="text-amber-600" strokeWidth={1.5} />
        </div>
        <h1 className="text-3xl font-bold text-stone-900 mb-3">Get in touch</h1>
        <p className="text-stone-500 text-base mb-10 leading-relaxed">
          Questions about QYRO Assist, pricing, or want to see a live demo? Send us an email and we&apos;ll get back to you within one business day.
        </p>

        <a
          href="mailto:support@qyro.us"
          className="inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-xl bg-stone-900 text-white hover:bg-stone-800 transition-colors shadow-sm"
        >
          <Mail size={14} strokeWidth={2} />
          support@qyro.us
        </a>

        <div className="mt-16 rounded-2xl border border-stone-200 bg-white p-8 text-left">
          <h2 className="text-base font-semibold text-stone-900 mb-4">What to include in your message</h2>
          <ul className="space-y-2.5">
            {[
              "Your business name and type (e.g. HVAC, dental practice, agency)",
              "How many inbound calls you receive per week",
              "What you're hoping QYRO Assist can help with",
              "The best time to connect for a short call",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-stone-600">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0 mt-1.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-10 text-xs text-stone-400">
          Zentryx LLC · Hillsboro, Oregon ·{" "}
          <Link href="/privacy" className="hover:text-stone-700 transition-colors">Privacy Policy</Link>
        </p>
      </main>
    </div>
  );
}
