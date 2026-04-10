"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

// Reads ?plan=assist-starter|growth|pro from URL and persists to localStorage
// so onboarding can pre-select the plan after Clerk redirects back.
export default function PlanCapture() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const plan = searchParams?.get("plan");
    if (plan && plan.startsWith("assist-")) {
      try {
        localStorage.setItem("qyro_plan_intent", plan);
      } catch {
        // localStorage unavailable — ignore
      }
    }
  }, [searchParams]);

  return null;
}
