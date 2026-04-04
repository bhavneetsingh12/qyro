import { auth } from "@clerk/nextjs/server";
import ApprovalQueue, { type QueueItem } from "./ApprovalQueue";

const API_URL = process.env.API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

export default async function ApprovalsPage() {
  const { getToken } = await auth();
  const token = await getToken();

  let items: QueueItem[] = [];
  let fetchError = false;

  if (token) {
    try {
      const res = await fetch(`${API_URL}/api/campaigns/queue`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.ok) {
        const body = await res.json();
        items = body.data ?? [];
      } else {
        fetchError = true;
      }
    } catch {
      fetchError = true;
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Approval Queue</h1>
          <p className="text-sm text-stone-400 mt-0.5">
            {fetchError
              ? "Could not load queue"
              : items.length === 0
              ? "All caught up"
              : `${items.length} message${items.length === 1 ? "" : "s"} pending review`}
          </p>
        </div>
        {items.length > 0 && (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
            {items.length}
          </span>
        )}
      </div>

      {fetchError ? (
        <div className="mt-6 bg-white border border-[#E8E6E1] rounded-[14px] px-5 py-10 text-center">
          <p className="text-sm text-rose-500 font-medium">Could not reach API</p>
          <p className="text-xs text-stone-400 mt-1">Make sure API_URL / NEXT_PUBLIC_API_URL points to https://api.qyro.us.</p>
        </div>
      ) : (
        <ApprovalQueue initialItems={items} />
      )}
    </div>
  );
}
