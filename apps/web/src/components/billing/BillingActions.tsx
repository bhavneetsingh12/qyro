"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

type ProductAccess = {
  lead: boolean;
  assist: boolean;
};

type BillingProduct = "lead" | "assist";

export default function BillingActions({ productAccess }: { productAccess: ProductAccess }) {
  const { getToken } = useAuth();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(product: BillingProduct) {
    setLoadingAction(product);
    setError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication required");

      const res = await fetch(`${API_URL}/api/v1/billing/checkout-session`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ product, plan: "starter" }),
      });

      const body = (await res.json().catch(() => ({}))) as { data?: { url?: string; destination?: string }; message?: string; error?: string };
      if (res.status === 409 && body.data?.destination) {
        window.location.href = body.data.destination;
        return;
      }
      if (!res.ok || !body.data?.url) {
        throw new Error(body.message ?? body.error ?? "Could not start checkout");
      }

      window.location.href = body.data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
      setLoadingAction(null);
    }
  }

  async function openPortal() {
    setLoadingAction("portal");
    setError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication required");

      const res = await fetch(`${API_URL}/api/v1/billing/portal-session`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const body = (await res.json().catch(() => ({}))) as { data?: { url?: string }; message?: string; error?: string };
      if (!res.ok || !body.data?.url) {
        throw new Error(body.message ?? body.error ?? "Could not open billing portal");
      }

      window.location.href = body.data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing portal");
      setLoadingAction(null);
    }
  }

  const canManage = productAccess.lead || productAccess.assist;

  return (
    <div id="billing" className="mt-6 rounded-2xl border border-stone-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-stone-900">Billing</h3>
      <p className="text-xs text-stone-500 mt-1">
        Start with Starter plans here. You can upgrade or cancel anytime from the billing portal.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {!productAccess.lead && (
          <button
            type="button"
            onClick={() => void startCheckout("lead")}
            disabled={loadingAction !== null}
            className="text-xs font-medium px-3 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-60"
          >
            {loadingAction === "lead" ? "Opening checkout..." : "Add QYRO Lead"}
          </button>
        )}

        {!productAccess.assist && (
          <button
            type="button"
            onClick={() => void startCheckout("assist")}
            disabled={loadingAction !== null}
            className="text-xs font-medium px-3 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-60"
          >
            {loadingAction === "assist" ? "Opening checkout..." : "Add QYRO Assist"}
          </button>
        )}

        {canManage && (
          <button
            type="button"
            onClick={() => void openPortal()}
            disabled={loadingAction !== null}
            className="text-xs font-medium px-3 py-2 rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-50 disabled:opacity-60"
          >
            {loadingAction === "portal" ? "Opening portal..." : "Manage Billing"}
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
