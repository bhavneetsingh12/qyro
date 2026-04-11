"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

// Reads ?plan=<product>-<tier> from URL and persists to localStorage
// so onboarding can pre-select the product + plan after Clerk redirects back.
export default function PlanCapture() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const plan = searchParams?.get("plan");
    if (plan && /^(assist|lead|bundle)-(starter|growth|pro)$/.test(plan)) {
      try {
        localStorage.setItem("qyro_plan_intent", plan);
      } catch {
        // localStorage unavailable — ignore
      }
    }
  }, [searchParams]);

  return null;
}
