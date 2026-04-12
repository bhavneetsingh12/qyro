import { auth } from "@clerk/nextjs/server";

const API_URL = process.env.API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

type Appointment = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  notes: string | null;
  prospectName: string | null;
  prospectPhone: string | null;
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_STYLES: Record<string, string> = {
  confirmed:  "bg-teal-50 text-teal-700",
  proposed:   "bg-amber-50 text-amber-700",
  cancelled:  "bg-stone-100 text-stone-400",
};

export default async function BookingsPage() {
  const { getToken } = await auth();
  const token = await getToken();

  let appointments: Appointment[] = [];
  let fetchError = false;

  if (token) {
    try {
      const res = await fetch(`${API_URL}/api/appointments?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const body = (await res.json()) as { data?: Appointment[] };
        appointments = body.data ?? [];
      } else {
        fetchError = true;
      }
    } catch {
      fetchError = true;
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Bookings</h1>
        <p className="text-sm text-stone-400 mt-0.5">
          {fetchError
            ? "Could not load bookings"
            : appointments.length === 0
            ? "No bookings yet"
            : `${appointments.length} appointment${appointments.length === 1 ? "" : "s"}`}
        </p>
      </div>

      <div className="mt-6 bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
        {fetchError ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-rose-500 font-medium">Could not reach API</p>
            <p className="text-xs text-stone-400 mt-1">Make sure API_URL / NEXT_PUBLIC_API_URL points to https://api.qyro.us.</p>
          </div>
        ) : appointments.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-stone-700">No appointments yet</p>
            <p className="mt-1 text-sm text-stone-400">Your AI assistant will place confirmed bookings here once scheduling is configured.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* Table header */}
            <div className="px-5 py-3 border-b border-[#F0EEE9] grid grid-cols-[1fr_auto_auto] gap-6 items-center min-w-[400px]">
              <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">Prospect</p>
              <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">Start time</p>
              <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">Status</p>
            </div>

            <ul className="divide-y divide-[#F0EEE9]">
              {appointments.map((a) => (
                <li
                  key={a.id}
                  className="px-5 py-3 grid grid-cols-[1fr_auto_auto] gap-6 items-center hover:bg-[#FAFAF8] transition-colors min-w-[400px]"
                >
                  {/* Prospect */}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-800 truncate">
                      {a.prospectName ?? "Unknown"}
                    </p>
                    {a.prospectPhone && (
                      <p className="text-xs text-stone-400 mt-0.5 truncate">{a.prospectPhone}</p>
                    )}
                    {a.notes && (
                      <p className="text-xs text-stone-400 mt-0.5 truncate italic">{a.notes}</p>
                    )}
                  </div>

                  {/* Start time */}
                  <p className="text-sm text-stone-600 shrink-0 tabular-nums">
                    {formatDateTime(a.startAt)}
                  </p>

                  {/* Status badge */}
                  <span className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full shrink-0 capitalize ${
                    STATUS_STYLES[a.status] ?? "bg-stone-100 text-stone-500"
                  }`}>
                    {a.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
