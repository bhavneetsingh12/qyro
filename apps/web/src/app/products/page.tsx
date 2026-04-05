import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";

const API_URL = process.env.API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

export default async function ProductsPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect("/sign-in");

  let productAccess = { lead: true, assist: true };
  try {
    const token = await getToken();
    if (token) {
      const res = await fetch(`${API_URL}/api/v1/tenants/settings`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.ok) {
        const body = await res.json();
        productAccess = body.productAccess ?? productAccess;
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
      description: "Internal lead sourcing, research, campaign drafting, and approvals.",
    },
    {
      href: "/assist",
      key: "assist" as const,
      label: "QYRO Assist",
      description: "Client assistant workflows: conversations, bookings, calls, approvals, and widget setup.",
    },
  ];

  return (
    <main className="min-h-screen bg-[#F7F6F2] flex items-center justify-center px-4">
      <div className="w-full max-w-3xl">
        <h1 className="text-3xl md:text-4xl font-semibold text-stone-900 text-center">Choose Product</h1>
        <p className="text-stone-600 text-center mt-2">
          QYRO Lead and QYRO Assist are separate product surfaces under the same company account.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
          {products.map(({ href, key, label, description }) => {
            const enabled = productAccess[key];
            if (enabled) {
              return (
                <Link
                  key={key}
                  href={href}
                  className="block rounded-2xl border border-stone-200 bg-white p-6 hover:shadow-sm transition-shadow"
                >
                  <p className="text-xs uppercase tracking-wide text-stone-500">Product</p>
                  <h2 className="text-xl font-semibold text-stone-900 mt-1">{label}</h2>
                  <p className="text-sm text-stone-600 mt-2">{description}</p>
                </Link>
              );
            }
            return (
              <div
                key={key}
                className="block rounded-2xl border border-stone-200 bg-stone-50 p-6 opacity-60 cursor-not-allowed"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wide text-stone-500">Product</p>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-stone-500 bg-stone-200 px-2 py-0.5 rounded-full">
                    <Lock size={10} strokeWidth={2} />
                    Not available
                  </span>
                </div>
                <h2 className="text-xl font-semibold text-stone-400 mt-1">{label}</h2>
                <p className="text-sm text-stone-400 mt-2">{description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
