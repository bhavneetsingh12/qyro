import Link from "next/link";
import { QyroMark } from "@/components/brand/QyroBrand";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] text-stone-900">
      <header className="border-b border-stone-200 py-4 px-6">
        <Link href="/" className="inline-flex items-center gap-2">
          <QyroMark surface="core" />
          <span className="text-sm font-bold tracking-tight">QYRO</span>
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-stone-900 mb-2">Terms of Service</h1>
        <p className="text-sm text-stone-500 mb-10">Last updated: April 2026 — Zentryx LLC</p>

        <div className="prose prose-stone max-w-none space-y-8 text-sm text-stone-700 leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">1. Acceptance of Terms</h2>
            <p>
              By accessing or using QYRO services provided by Zentryx LLC (&quot;Company,&quot; &quot;we,&quot; &quot;us&quot;), you agree to be bound by these Terms of Service. If you do not agree, do not use the service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">2. Description of Service</h2>
            <p>
              QYRO provides AI-powered lead generation and client communication tools, including QYRO Lead (outbound lead engine) and QYRO Assist (AI voice and chat assistant). Services are provided on a subscription basis to businesses.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">3. Acceptable Use</h2>
            <p>You agree not to use QYRO to contact individuals who have opted out or are on do-not-call lists, send unsolicited messages in violation of CAN-SPAM or TCPA, misrepresent your business identity, or engage in any unlawful outreach activity. You are responsible for ensuring your use of QYRO complies with all applicable federal and state laws, including the TCPA, FCC regulations, and state telemarketing laws.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">4. Billing and Subscriptions</h2>
            <p>
              Subscriptions are billed monthly. Charges are non-refundable except where required by law. You may cancel at any time; access continues through the end of the current billing period. Failed payments may result in suspension of service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">5. Data and Privacy</h2>
            <p>
              Your use of QYRO is also governed by our <Link href="/privacy" className="text-amber-600 hover:underline">Privacy Policy</Link>. You retain ownership of your data. We process it only to provide the service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">6. Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by law, Zentryx LLC shall not be liable for any indirect, incidental, or consequential damages arising from your use of QYRO. Our total liability shall not exceed the fees paid by you in the 12 months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">7. Changes to Terms</h2>
            <p>
              We may update these terms at any time. Material changes will be communicated via email or in-app notice. Continued use after changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">8. Contact</h2>
            <p>
              Questions about these terms: Zentryx LLC, Hillsboro, Oregon. Contact us through your account portal.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
