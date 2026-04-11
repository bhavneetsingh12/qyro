import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

const API_URL = process.env.API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

export default async function ProductsPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect("/sign-in");

  try {
    const token = await getToken();
    if (token) {
      const res = await fetch(`${API_URL}/api/v1/tenants/settings`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.ok) {
        const body = await res.json();

        // Master admin always goes to ops dashboard, never onboarding
        if (body.isMasterAdmin === true) redirect("/qx-ops");

        const access = body.productAccess ?? { lead: false, assist: false };

        // If the tenant already has product access they've effectively onboarded —
        // send them to their dashboard regardless of the onboarding_complete flag.
        // This handles existing tenants created before the onboarding flow was built.
        if (access.assist) redirect("/client/dashboard");
        if (access.lead) redirect("/internal/dashboard");

        // Only redirect to onboarding if they genuinely have no access yet
        if (body.onboardingComplete === false) redirect("/onboarding");
      }
    }
  } catch {
    // Fall through to onboarding on API error (only for non-authed or broken state)
  }

  redirect("/onboarding");
}
