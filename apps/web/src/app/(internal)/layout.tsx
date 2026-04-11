import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import InternalSidebar from "@/components/sidebar/InternalSidebar";

const API_URL = process.env.API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

export default async function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { getToken } = await auth();
  const token = await getToken();
  let canSwitchToAssist = false;
  let showAssistUpgrade = false;

  // Entitlement check — redirect to product selector if Lead not enabled
  let approvalCount = 0;
  if (token) {
    try {
      const settingsRes = await fetch(`${API_URL}/api/v1/tenants/settings`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        const access = settings.productAccess ?? { lead: true, assist: true };
        const isMasterAdmin = settings.isMasterAdmin === true;
        canSwitchToAssist = access.lead === true && access.assist === true;
        showAssistUpgrade = access.lead === true && access.assist === false;
        if (!isMasterAdmin && access.lead === false) {
          redirect("/products");
        }
      }
    } catch {
      // Network error — allow through rather than lock user out
    }

    try {
      const res = await fetch(`${API_URL}/api/campaigns/queue`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.ok) {
        const body = await res.json();
        approvalCount = body.count ?? 0;
      }
    } catch {
      // Badge stays 0 on error — non-critical
    }
  }

  return (
    <div className="flex h-screen bg-[#FAFAF8]">
      <InternalSidebar
        approvalCount={approvalCount}
        canSwitchToAssist={canSwitchToAssist}
        showAssistUpgrade={showAssistUpgrade}
      />
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        {children}
      </main>
    </div>
  );
}
