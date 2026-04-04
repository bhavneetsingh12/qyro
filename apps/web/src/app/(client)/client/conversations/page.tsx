import { auth } from "@clerk/nextjs/server";

const API_URL = process.env.API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

type Session = {
  id: string;
  sessionType: string;
  turnCount: number;
  escalated: boolean;
  createdAt: string;
  prospectName: string | null;
  prospectPhone: string | null;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function ConversationsPage() {
  const { getToken } = await auth();
  const token = await getToken();

  let sessions: Session[] = [];
  let fetchError = false;

  if (token) {
    try {
      const res = await fetch(`${API_URL}/api/sessions?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.ok) {
        const body = await res.json();
        sessions = body.data ?? [];
      } else {
        fetchError = true;
      }
    } catch {
      fetchError = true;
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Conversations</h1>
          <p className="text-sm text-stone-400 mt-0.5">
            {fetchError
              ? "Could not load conversations"
              : sessions.length === 0
              ? "No conversations yet"
              : `${sessions.length} conversation${sessions.length === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      <div className="mt-6 bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
        {fetchError ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-rose-500 font-medium">Could not reach API</p>
            <p className="text-xs text-stone-400 mt-1">Make sure API_URL / NEXT_PUBLIC_API_URL points to https://api.qyro.us.</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-stone-400">No conversations yet. Your AI assistant will handle them here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* Table header */}
            <div className="px-5 py-3 border-b border-[#F0EEE9] grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 items-center min-w-[520px]">
              <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">Prospect</p>
              <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">Type</p>
              <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">Turns</p>
              <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">Status</p>
              <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">Date</p>
            </div>

            <ul className="divide-y divide-[#F0EEE9]">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="px-5 py-3 grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 items-center hover:bg-[#FAFAF8] transition-colors min-w-[520px]"
                >
                  {/* Prospect */}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-800 truncate">
                      {s.prospectName ?? "Unknown"}
                    </p>
                    {s.prospectPhone && (
                      <p className="text-xs text-stone-400 mt-0.5 truncate">{s.prospectPhone}</p>
                    )}
                  </div>

                  {/* Session type */}
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                    s.sessionType === "missed_call_sms"
                      ? "bg-rose-50 text-rose-600"
                      : "bg-amber-50 text-amber-700"
                  }`}>
                    {s.sessionType === "missed_call_sms" ? "Missed call" : "Widget"}
                  </span>

                  {/* Turn count */}
                  <p className="text-sm text-stone-500 tabular-nums text-center">{s.turnCount}</p>

                  {/* Escalated badge */}
                  <div className="flex justify-center">
                    {s.escalated ? (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-600">
                        Escalated
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-stone-100 text-stone-400">
                        OK
                      </span>
                    )}
                  </div>

                  {/* Date */}
                  <p className="text-xs text-stone-400 shrink-0 text-right">{formatDate(s.createdAt)}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
