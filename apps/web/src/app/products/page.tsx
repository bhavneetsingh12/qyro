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

        if (body.isMasterAdmin === true) redirect("/qx-ops");
        if (body.onboardingComplete === false) redirect("/onboarding");

        const access = body.productAccess ?? { lead: false, assist: false };
        if (access.assist) redirect("/client/dashboard");
        if (access.lead) redirect("/internal/dashboard");
      }
    }
  } catch {
    // Fall through to onboarding on API error
  }

  redirect("/onboarding");
}
