import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import ClientSidebar from "@/components/sidebar/ClientSidebar";

const API_URL = process.env.API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { getToken } = await auth();
  const token = await getToken();
  let canSwitchToLead = false;
  let showLeadUpgrade = false;

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
        canSwitchToLead = access.lead === true && access.assist === true;
        showLeadUpgrade = access.assist === true && access.lead === false;
        if (!isMasterAdmin && access.assist === false) {
          redirect("/products");
        }
      }
    } catch {
      // Network error — allow through rather than lock user out
    }
  }

  return (
    <div className="flex h-screen bg-[#FAFAF8]">
      <ClientSidebar canSwitchToLead={canSwitchToLead} showLeadUpgrade={showLeadUpgrade} />
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        {children}
      </main>
    </div>
  );
}
