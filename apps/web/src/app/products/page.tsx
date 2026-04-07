import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Lock, Users, PhoneCall } from "lucide-react";
import BillingActions from "@/components/billing/BillingActions";
import { QyroBrandLockup } from "@/components/brand/QyroBrand";
import SignOutButton from "@/components/auth/SignOutButton";

const API_URL = process.env.API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

export default async function ProductsPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect("/sign-in");

  let productAccess = { lead: true, assist: true };
  let showBillingStatus = true;
  try {
    const token = await getToken();
    if (token) {
      const res = await fetch(`${API_URL}/api/v1/tenants/settings`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.ok) {
        const body = await res.json();
        if (body.isMasterAdmin === true) {
          redirect("/admin");
        }
        productAccess = body.productAccess ?? productAccess;
        showBillingStatus = body.showBillingStatus !== false;
      }
    }
  } catch {
    // Defaults — show both as accessible on API error
  }

  const products = [
    {
      href: "/lead",
      key: "lead" as const,
      label: "QYRO Lead",
      description: "Automated lead sourcing, AI research, campaign drafting, and approvals.",
      icon: Users,
      iconBg: "bg-amber-500",
    },
    {
      href: "/assist",
      key: "assist" as const,
      label: "QYRO Assist",
      description: "AI voice agent for inbound & outbound calls, bookings, and client conversations.",
      icon: PhoneCall,
      iconBg: "bg-stone-900",
    },
  ];

  return (
    <main className="min-h-screen bg-[#F7F6F2] flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-3xl">
        <div className="mb-5 flex justify-end">
          <SignOutButton
            className="text-xs font-medium text-stone-500 hover:text-stone-900 transition-colors"
            label="Sign out"
          />
        </div>

        {/* Brand */}
        <div className="text-center mb-10">
          <div className="flex justify-center mb-3">
            <QyroBrandLockup surface="core" align="center" />
          </div>
          <h1 className="text-2xl font-bold text-stone-900">Choose your product</h1>
          <p className="text-sm text-stone-500 mt-1 max-w-sm mx-auto">
            QYRO Lead and QYRO Assist are separate surfaces under the same account.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {products.map(({ href, key, label, description, icon: Icon, iconBg }) => {
            const enabled = productAccess[key];
            if (enabled) {
              return (
                <Link
                  key={key}
                  href={href}
                  className="group block rounded-2xl border border-stone-200 bg-white p-7 hover:shadow-md hover:border-stone-300 transition-all"
                >
                  <div className={`h-10 w-10 rounded-xl ${iconBg} flex items-center justify-center mb-4 shadow-sm`}>
                    <Icon size={18} className="text-white" strokeWidth={2} />
                  </div>
                  <h2 className="text-lg font-bold text-stone-900 group-hover:text-stone-700 transition-colors">{label}</h2>
                  <p className="text-sm text-stone-500 mt-1.5 leading-relaxed">{description}</p>
                  <p className="text-xs font-semibold text-amber-600 mt-4">Open →</p>
                </Link>
              );
            }
            return (
              <div
                key={key}
                className="block rounded-2xl border border-stone-200 bg-stone-50 p-7 opacity-60 cursor-not-allowed"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`h-10 w-10 rounded-xl ${iconBg} flex items-center justify-center shadow-sm opacity-40`}>
                    <Icon size={18} className="text-white" strokeWidth={2} />
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-stone-500 bg-stone-200 px-2 py-1 rounded-full">
                    <Lock size={10} strokeWidth={2} />
                    Locked
                  </span>
                </div>
                <h2 className="text-lg font-bold text-stone-400">{label}</h2>
                <p className="text-sm text-stone-400 mt-1.5 leading-relaxed">{description}</p>
              </div>
            );
          })}
        </div>

        {showBillingStatus && <BillingActions productAccess={productAccess} />}
      </div>
    </main>
  );
}
