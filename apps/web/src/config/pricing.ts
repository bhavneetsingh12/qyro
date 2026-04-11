export type AssistPlan = "starter" | "growth" | "pro";

export type PricingTier = {
  key: AssistPlan;
  label: string;
  price: number;
  tagline: string;
  popular?: boolean;
  features: string[];
};

export type LeadPricingTier = {
  key: AssistPlan;
  label: string;
  price: number;
  tagline: string;
  features: string[];
};

export const ASSIST_PRICING = {
  currency: "USD",
  overagePerMin: 0.35,
  tiers: [
    {
      key: "starter" as AssistPlan,
      label: "Starter",
      price: 297,
      tagline: "Perfect for small businesses handling everyday call volume.",
      features: [
        "300 AI-handled minutes/month",
        "1 number connected",
        "AI inbound call handling",
        "Missed-call SMS follow-up",
        "FAQ & appointment booking",
        "Website chat widget",
        "Call transcripts (90-day retention)",
      ],
    },
    {
      key: "growth" as AssistPlan,
      label: "Growth",
      price: 497,
      tagline: "For growing businesses that need more volume and outbound follow-up.",
      popular: true,
      features: [
        "600 AI-handled minutes/month",
        "Up to 3 numbers connected",
        "Everything in Starter",
        "Inbound + outbound follow-up",
        "CRM sync",
        "Multi-user team access",
        "Advanced call control center",
      ],
    },
    {
      key: "pro" as AssistPlan,
      label: "Pro",
      price: 797,
      tagline: "High-volume operations with custom voice and unlimited number connections.",
      features: [
        "1,200 AI-handled minutes/month",
        "Unlimited numbers connected",
        "Everything in Growth",
        "Custom voice persona",
        "Priority support",
        "Dedicated onboarding",
        "Early access to new features",
      ],
    },
  ] satisfies PricingTier[],
};

export const LEAD_PRICING = {
  currency: "USD",
  availableNow: true,
  tiers: [
    {
      key: "starter" as AssistPlan,
      label: "Starter",
      price: 299,
      tagline: "For solo operators and small teams.",
      features: [
        "500 leads/month",
        "AI research & scoring",
        "Campaign drafting",
        "Approval workflow",
        "CSV export",
      ],
    },
    {
      key: "growth" as AssistPlan,
      label: "Growth",
      price: 599,
      tagline: "Scale your outreach pipeline.",
      features: [
        "2,000 leads/month",
        "Everything in Starter",
        "Multi-campaign management",
        "Team collaboration",
        "CRM integrations",
      ],
    },
    {
      key: "pro" as AssistPlan,
      label: "Pro",
      price: 1199,
      tagline: "Enterprise-grade lead operations.",
      features: [
        "Unlimited leads",
        "Everything in Growth",
        "White-label options",
        "API access",
        "Dedicated support",
      ],
    },
  ] satisfies LeadPricingTier[],
};
