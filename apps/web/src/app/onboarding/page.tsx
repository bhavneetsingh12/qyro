"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { ArrowRight, CheckCircle, PhoneCall, Users, Loader2, Check } from "lucide-react";
import { QyroBrandLockup } from "@/components/brand/QyroBrand";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

const INDUSTRIES = [
  "Dental",
  "Medical / Healthcare",
  "Home Services",
  "Beauty / Medspa",
  "Real Estate",
  "Legal",
  "Financial Services",
  "Auto Repair",
  "Restaurant / Food",
  "Retail",
  "Other",
];

const TIMEZONES = [
  { label: "Pacific (PT)", value: "America/Los_Angeles" },
  { label: "Mountain (MT)", value: "America/Denver" },
  { label: "Arizona (no DST)", value: "America/Phoenix" },
  { label: "Central (CT)", value: "America/Chicago" },
  { label: "Eastern (ET)", value: "America/New_York" },
  { label: "Alaska (AKT)", value: "America/Anchorage" },
  { label: "Hawaii (HT)", value: "Pacific/Honolulu" },
];

const ASSIST_PLANS = [
  {
    key: "starter" as const,
    name: "Starter",
    price: "$297",
    period: "/mo",
    features: [
      "AI inbound receptionist",
      "Unlimited inbound calls",
      "Appointment booking",
      "Missed-call SMS follow-up",
      "Email support",
    ],
    highlight: false,
  },
  {
    key: "growth" as const,
    name: "Growth",
    price: "$497",
    period: "/mo",
    features: [
      "Everything in Starter",
      "Custom AI personality & tone",
      "Multiple phone numbers",
      "Analytics dashboard",
      "Priority support",
    ],
    highlight: true,
  },
  {
    key: "pro" as const,
    name: "Pro",
    price: "$797",
    period: "/mo",
    features: [
      "Everything in Growth",
      "Outbound callback campaigns",
      "Dedicated onboarding call",
      "SLA guarantee",
      "Phone support",
    ],
    highlight: false,
  },
] as const;

type PlanKey = (typeof ASSIST_PLANS)[number]["key"];
type ProductType = "assistant" | "lead_engine";

type FormState = {
  productType: ProductType | null;
  name: string;
  industry: string;
  phone: string;
  timezone: string;
  businessDescription: string;
  services: string;
  greeting: string;
};

const STORAGE_KEY = "qyro_onboarding_draft";
const TOTAL_STEPS = 5;

function StepDots({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i < current
              ? "bg-amber-500 w-6"
              : i === current
              ? "bg-stone-900 w-6"
              : "bg-stone-200 w-3"
          }`}
        />
      ))}
    </div>
  );
}

// ─── Step 0: Product selection ────────────────────────────────────────────────

function StepProduct({
  value,
  onChange,
  onNext,
}: {
  value: ProductType | null;
  onChange: (v: ProductType) => void;
  onNext: () => void;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-stone-900 mb-1">What are you signing up for?</h1>
      <p className="text-sm text-stone-500 mb-7">
        Choose the product that fits your needs. You can unlock the other later.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {/* QYRO Assist */}
        <button
          type="button"
          onClick={() => onChange("assistant")}
          className={`text-left rounded-2xl border-2 p-6 transition-all ${
            value === "assistant"
              ? "border-amber-400 bg-amber-50"
              : "border-stone-200 bg-white hover:border-stone-300"
          }`}
        >
          <div className="h-10 w-10 rounded-xl bg-stone-900 flex items-center justify-center mb-4 shadow-sm">
            <PhoneCall size={18} className="text-white" strokeWidth={2} />
          </div>
          <h2 className="text-base font-bold text-stone-900">QYRO Assist</h2>
          <p className="text-sm text-stone-500 mt-1 leading-relaxed">
            AI receptionist for your business — handles calls, books appointments, follows up.
          </p>
          <p className="text-xs font-semibold text-amber-600 mt-3">From $297/mo</p>
        </button>

        {/* QYRO Lead — coming soon */}
        <div className="relative rounded-2xl border-2 border-stone-100 bg-stone-50 p-6 opacity-60 cursor-not-allowed">
          <div className="h-10 w-10 rounded-xl bg-amber-400 flex items-center justify-center mb-4 shadow-sm opacity-60">
            <Users size={18} className="text-white" strokeWidth={2} />
          </div>
          <h2 className="text-base font-bold text-stone-400">QYRO Lead</h2>
          <p className="text-sm text-stone-400 mt-1 leading-relaxed">
            AI lead engine for agencies and sales teams — sourcing, research, outreach.
          </p>
          <span className="absolute top-4 right-4 text-xs font-semibold bg-stone-200 text-stone-500 px-2.5 py-1 rounded-full">
            Coming soon
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onNext}
        disabled={!value}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-stone-900 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-stone-800 transition-colors"
      >
        Continue
        <ArrowRight size={14} strokeWidth={2.5} />
      </button>
    </div>
  );
}

// ─── Step 1: Business info ────────────────────────────────────────────────────

function StepBusinessInfo({
  form,
  onChange,
  onNext,
  onBack,
}: {
  form: Pick<FormState, "name" | "industry" | "phone" | "timezone">;
  onChange: (field: keyof typeof form, value: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const canProceed = form.name.trim().length > 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Tell us about your business</h1>
      <p className="text-sm text-stone-500 mb-7">This helps QYRO set up your AI assistant correctly.</p>

      <div className="space-y-5 mb-8">
        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">
            Business name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            placeholder="e.g. Hillsboro Family Dental"
            value={form.name}
            onChange={(e) => onChange("name", e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">Industry</label>
          <select
            value={form.industry}
            onChange={(e) => onChange("industry", e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent bg-white"
          >
            <option value="">Select an industry</option>
            {INDUSTRIES.map((ind) => (
              <option key={ind} value={ind}>{ind}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">
              Business phone number
            </label>
            <input
              type="tel"
              placeholder="+1 (503) 555-0100"
              value={form.phone}
              onChange={(e) => onChange("phone", e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
            />
            <p className="text-xs text-stone-400 mt-1">The number your customers call today.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Timezone</label>
            <select
              value={form.timezone}
              onChange={(e) => onChange("timezone", e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent bg-white"
            >
              <option value="">Select timezone</option>
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-2.5 rounded-xl border border-stone-200 text-sm font-medium text-stone-600 hover:bg-stone-50 transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-stone-800 transition-colors"
        >
          Continue
          <ArrowRight size={14} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

// ─── Step 2: Choose plan ──────────────────────────────────────────────────────

function StepPlan({
  onSelectTrial,
  onSubscribe,
  onBack,
  subscribing,
  subscribingPlan,
  preSelectedPlan,
}: {
  onSelectTrial: () => void;
  onSubscribe: (plan: PlanKey) => void;
  onBack: () => void;
  subscribing: boolean;
  subscribingPlan: PlanKey | null;
  preSelectedPlan: PlanKey | null;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Choose your plan</h1>
      <p className="text-sm text-stone-500 mb-7">
        Start with a free 14-day trial or subscribe now. No contract, cancel anytime.
      </p>

      <div className="grid grid-cols-1 gap-3 mb-6">
        {ASSIST_PLANS.map((plan) => {
          const isPreSelected = preSelectedPlan === plan.key;
          const isHighlighted = plan.highlight || isPreSelected;
          return (
          <div
            key={plan.key}
            className={`relative rounded-2xl border-2 p-5 transition-all ${
              isPreSelected
                ? "border-stone-900 bg-stone-50 ring-2 ring-stone-900 ring-offset-2"
                : plan.highlight
                ? "border-amber-400 bg-amber-50"
                : "border-stone-200 bg-white"
            }`}
          >
            {isPreSelected && (
              <span className="absolute -top-3 left-5 text-xs font-bold bg-stone-900 text-white px-3 py-0.5 rounded-full">
                Your selection
              </span>
            )}
            {!isPreSelected && plan.highlight && (
              <span className="absolute -top-3 left-5 text-xs font-bold bg-amber-500 text-white px-3 py-0.5 rounded-full">
                Most popular
              </span>
            )}

            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 mb-1">
                  <span className="text-lg font-bold text-stone-900">{plan.price}</span>
                  <span className="text-xs text-stone-400">{plan.period}</span>
                  <span className="text-sm font-semibold text-stone-700 ml-1">{plan.name}</span>
                </div>
                <ul className="space-y-1 mt-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-1.5 text-xs text-stone-600">
                      <Check size={11} className="text-amber-500 shrink-0" strokeWidth={3} />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>

              <button
                type="button"
                disabled={subscribing}
                onClick={() => onSubscribe(plan.key)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isHighlighted
                    ? "bg-amber-500 text-white hover:bg-amber-600"
                    : "bg-stone-900 text-white hover:bg-stone-800"
                }`}
              >
                {subscribing && subscribingPlan === plan.key ? (
                  <><Loader2 size={12} className="animate-spin" /> Redirecting…</>
                ) : (
                  "Subscribe"
                )}
              </button>
            </div>
          </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 flex items-center justify-between gap-4 mb-6">
        <div>
          <p className="text-sm font-semibold text-stone-800">Not ready to commit?</p>
          <p className="text-xs text-stone-500 mt-0.5">
            Start free for 14 days — no credit card required.
          </p>
        </div>
        <button
          type="button"
          onClick={onSelectTrial}
          disabled={subscribing}
          className="shrink-0 px-4 py-2 rounded-xl border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-white transition-colors disabled:opacity-50"
        >
          Start free trial
        </button>
      </div>

      <button
        type="button"
        onClick={onBack}
        disabled={subscribing}
        className="px-5 py-2.5 rounded-xl border border-stone-200 text-sm font-medium text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-40"
      >
        Back
      </button>
    </div>
  );
}

// ─── Step 3: AI setup ─────────────────────────────────────────────────────────

function StepAiSetup({
  form,
  businessName,
  onChange,
  onNext,
  onBack,
  saving,
}: {
  form: Pick<FormState, "businessDescription" | "services" | "greeting">;
  businessName: string;
  onChange: (field: keyof typeof form, value: string) => void;
  onNext: () => void;
  onBack: () => void;
  saving: boolean;
}) {
  const displayName = businessName.trim() || "your business";

  return (
    <div>
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Set up your AI assistant</h1>
      <p className="text-sm text-stone-500 mb-7">
        Help your AI sound exactly like {displayName}.
      </p>

      <div className="space-y-5 mb-8">
        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">
            What does your business do?
          </label>
          <textarea
            rows={3}
            placeholder={`e.g. ${displayName} is a full-service dental practice in Hillsboro, OR. We offer cleanings, fillings, crowns, and cosmetic dentistry for patients of all ages.`}
            value={form.businessDescription}
            onChange={(e) => onChange("businessDescription", e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent resize-none"
          />
          <p className="text-xs text-stone-400 mt-1">2–3 sentences. The AI uses this to answer caller questions.</p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">
            Services you offer
          </label>
          <textarea
            rows={3}
            placeholder="e.g. Teeth cleaning, fillings, crowns, teeth whitening, emergency dental"
            value={form.services}
            onChange={(e) => onChange("services", e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent resize-none"
          />
          <p className="text-xs text-stone-400 mt-1">Comma-separated list of what you offer.</p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">
            Greeting message
          </label>
          <input
            type="text"
            placeholder={`Thank you for calling ${displayName}! How can I help you today?`}
            value={form.greeting}
            onChange={(e) => onChange("greeting", e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
          />
          <p className="text-xs text-stone-400 mt-1">What the AI says when a caller connects.</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="px-5 py-2.5 rounded-xl border border-stone-200 text-sm font-medium text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-40"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={saving}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold disabled:opacity-60 hover:bg-amber-600 transition-colors"
        >
          {saving ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Setting up...
            </>
          ) : (
            <>
              Finish setup
              <ArrowRight size={14} strokeWidth={2.5} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Step 4: Done ─────────────────────────────────────────────────────────────

function StepDone({ businessName, onGoToDashboard }: { businessName: string; onGoToDashboard: () => void }) {
  const displayName = businessName.trim() || "Your account";

  return (
    <div>
      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-green-50 border border-green-200 mb-5">
        <CheckCircle size={28} className="text-green-500" strokeWidth={1.5} />
      </div>
      <h1 className="text-2xl font-bold text-stone-900 mb-1">{displayName} is ready!</h1>
      <p className="text-sm text-stone-500 mb-8">
        Your AI assistant is set up. Here&apos;s how to activate it.
      </p>

      <div className="space-y-4 mb-8">
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-2">Step 1</p>
          <h3 className="text-sm font-bold text-stone-900 mb-1">Forward your business number</h3>
          <p className="text-sm text-stone-500 leading-relaxed">
            Go to your carrier settings and forward calls to your QYRO number. You&apos;ll find your QYRO number in{" "}
            <span className="font-medium text-stone-700">Settings → Voice</span>.
          </p>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-2">Step 2</p>
          <h3 className="text-sm font-bold text-stone-900 mb-1">Make a test call</h3>
          <p className="text-sm text-stone-500 leading-relaxed">
            Call your business number and let the AI pick up. Check the call transcript in your dashboard to see how it went.
          </p>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-2">Step 3</p>
          <h3 className="text-sm font-bold text-stone-900 mb-1">Manage your plan</h3>
          <p className="text-sm text-stone-500 leading-relaxed">
            View or upgrade your subscription from{" "}
            <span className="font-medium text-stone-700">Settings → Billing</span> at any time.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onGoToDashboard}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 transition-colors"
      >
        Go to dashboard
        <ArrowRight size={14} strokeWidth={2.5} />
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const { getToken } = useAuth();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [subscribingPlan, setSubscribingPlan] = useState<PlanKey | null>(null);
  const [preSelectedPlan, setPreSelectedPlan] = useState<PlanKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({
    productType: null,
    name: "",
    industry: "",
    phone: "",
    timezone: "",
    businessDescription: "",
    services: "",
    greeting: "",
  });

  // On mount: check for plan intent from pricing CTAs (?plan=assist-starter stored in localStorage)
  // and handle return from Stripe checkout (?subscribed=true in URL).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);

    if (params.get("subscribed") === "true") {
      // Returning from Stripe — restore saved draft and jump to AI setup
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as Partial<FormState>;
          setForm((prev) => ({ ...prev, ...parsed }));
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // ignore parse errors
      }
      setStep(3);
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    // Check for plan intent stored by PlanCapture on sign-up page
    try {
      const planIntent = localStorage.getItem("qyro_plan_intent");
      if (planIntent && planIntent.startsWith("assist-")) {
        const planKey = planIntent.replace("assist-", "") as PlanKey;
        const validKeys: PlanKey[] = ["starter", "growth", "pro"];
        if (validKeys.includes(planKey)) {
          setPreSelectedPlan(planKey);
          // Auto-select QYRO Assist and skip the product selection step
          setForm((prev) => ({ ...prev, productType: "assistant" }));
          setStep(1);
          localStorage.removeItem("qyro_plan_intent");
        }
      }
    } catch {
      // ignore localStorage errors
    }
  }, []);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function checkoutForPlan(plan: PlanKey) {
    setSubscribing(true);
    setSubscribingPlan(plan);
    setError(null);

    try {
      // Persist form state so we can restore it after Stripe redirects back
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          productType: form.productType,
          name: form.name,
          industry: form.industry,
          phone: form.phone,
          timezone: form.timezone,
        }),
      );

      const token = await getToken();
      const origin = window.location.origin;
      const res = await fetch(`${API_URL}/api/v1/billing/checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          product: "assist",
          plan,
          successUrl: `${origin}/onboarding?subscribed=true`,
          cancelUrl: `${origin}/onboarding`,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { message?: string }).message ?? "Failed to start checkout — please try again.",
        );
      }

      const body = await res.json();
      const url = (body as { data?: { url?: string } }).data?.url;
      if (!url) throw new Error("No checkout URL returned.");

      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout — please try again.");
      setSubscribing(false);
      setSubscribingPlan(null);
    }
  }

  async function saveAndFinish() {
    setSaving(true);
    setError(null);

    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/tenants/onboarding`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          productType: form.productType ?? "assistant",
          name: form.name,
          industry: form.industry,
          phone: form.phone,
          timezone: form.timezone,
          businessDescription: form.businessDescription,
          services: form.services,
          greeting: form.greeting,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? "Failed to save — please try again.");
      }

      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save — please try again.");
    } finally {
      setSaving(false);
    }
  }

  function goToDashboard() {
    router.push(form.productType === "assistant" ? "/client/dashboard" : "/internal/dashboard");
  }

  return (
    <main className="min-h-screen bg-[#F7F6F2] flex flex-col items-center justify-start px-4 py-12">
      <div className="w-full max-w-xl">
        {/* Brand */}
        <div className="flex justify-center mb-10">
          <QyroBrandLockup surface="core" align="center" />
        </div>

        {/* Step indicator */}
        <StepDots current={step} />

        {/* Card */}
        <div className="rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
          {error && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {step === 0 && (
            <StepProduct
              value={form.productType}
              onChange={(v) => updateField("productType", v)}
              onNext={() => setStep(1)}
            />
          )}

          {step === 1 && (
            <StepBusinessInfo
              form={form}
              onChange={(field, value) => updateField(field, value)}
              onNext={() => setStep(2)}
              onBack={() => setStep(0)}
            />
          )}

          {step === 2 && (
            <StepPlan
              onSelectTrial={() => setStep(3)}
              onSubscribe={checkoutForPlan}
              onBack={() => setStep(1)}
              subscribing={subscribing}
              subscribingPlan={subscribingPlan}
              preSelectedPlan={preSelectedPlan}
            />
          )}

          {step === 3 && (
            <StepAiSetup
              form={form}
              businessName={form.name}
              onChange={(field, value) => updateField(field, value)}
              onNext={saveAndFinish}
              onBack={() => setStep(2)}
              saving={saving}
            />
          )}

          {step === 4 && (
            <StepDone businessName={form.name} onGoToDashboard={goToDashboard} />
          )}
        </div>

        {step < 4 && (
          <p className="text-center text-xs text-stone-400 mt-4">
            Step {step + 1} of {TOTAL_STEPS}
          </p>
        )}
      </div>
    </main>
  );
}
