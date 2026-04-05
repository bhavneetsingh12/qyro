import Link from "next/link";
import { QyroMark } from "@/components/brand/QyroBrand";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] text-stone-900">
      <header className="border-b border-stone-200 py-4 px-6">
        <Link href="/" className="inline-flex items-center gap-2">
          <QyroMark surface="core" />
          <span className="text-sm font-bold tracking-tight">QYRO</span>
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-stone-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-stone-500 mb-10">Last updated: April 2026 — Zentryx LLC</p>

        <div className="prose prose-stone max-w-none space-y-8 text-sm text-stone-700 leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">1. Information We Collect</h2>
            <p>
              We collect information you provide when creating an account (name, email, business details), data generated through use of the platform (call logs, conversation transcripts, prospect records), and technical data (IP addresses, session identifiers) needed to operate the service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">2. How We Use Your Information</h2>
            <p>
              We use your data to provide and improve QYRO services, process payments, communicate service updates, and ensure compliance with legal obligations. We do not sell your data to third parties.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">3. Prospect and Contact Data</h2>
            <p>
              Data about prospects and contacts processed through QYRO belongs to you. We process it as a data processor on your behalf. You are responsible for ensuring you have appropriate consent or lawful basis for contacting individuals through our platform.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">4. Call Recordings and Transcripts</h2>
            <p>
              Voice call recordings and AI-generated transcripts are stored for up to 90 days and then deleted. You may request earlier deletion through your account settings. All calls include an automated disclosure that the call may be recorded.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">5. Data Retention</h2>
            <p>
              Account data is retained for the life of your subscription plus 30 days after cancellation. Do-not-contact records are retained indefinitely as required for compliance. You may request deletion of your account data by contacting us.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">6. Third-Party Services</h2>
            <p>
              QYRO integrates with third-party services including Clerk (authentication), Stripe (payments), SignalWire (voice telephony), OpenAI (AI processing), and Cal.com (calendar booking). Each service has its own privacy policy governing their data handling.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">7. Security</h2>
            <p>
              We implement industry-standard security measures including encrypted data in transit (TLS), isolated tenant data storage, and access controls. We promptly notify affected users of any confirmed data breaches.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">8. Your Rights</h2>
            <p>
              You have the right to access, correct, or delete your personal data. Oregon residents have additional rights under OCPA. Contact us through your account portal to exercise these rights.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-stone-900 mb-2">9. Contact</h2>
            <p>
              Privacy questions: Zentryx LLC, Hillsboro, Oregon. Contact us through your account portal or the website.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
