import { auth } from "@clerk/nextjs/server";
import { MessageSquare, CalendarCheck, PhoneMissed, Zap, AlertCircle } from "lucide-react";

const API_URL = process.env.API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

type Session = {
  id: string;
  sessionType: string;
  escalated: boolean;
  createdAt: string;
};

type Appointment = {
  id: string;
  startAt: string;
  status: string;
};

async function apiFetch<T>(path: string, token: string | null): Promise<{ data: T | null; error: boolean }> {
  if (!token) return { data: null, error: false };
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return { data: null, error: true };
    return { data: await res.json(), error: false };
  } catch {
    return { data: null, error: true };
  }
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function ClientDashboardPage() {
  const { getToken } = await auth();
  const token = await getToken();

  const [sessionsResult, appointmentsResult] = await Promise.all([
    apiFetch<{ data: Session[] }>("/api/sessions?limit=200", token),
    apiFetch<{ data: Appointment[] }>("/api/appointments?limit=200", token),
  ]);

  const fetchError = sessionsResult.error && appointmentsResult.error;
  const sessions: Session[] = (sessionsResult.data as { data: Session[] } | null)?.data ?? [];
  const appointments: Appointment[] = (appointmentsResult.data as { data: Appointment[] } | null)?.data ?? [];

  const today = new Date().toDateString();

  const conversationsToday = sessions.filter(
    (s) => new Date(s.createdAt).toDateString() === today
  ).length;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const bookingsThisWeek = appointments.filter(
    (a) => new Date(a.startAt) >= weekAgo
  ).length;

  const missedCalls = sessions.filter(
    (s) => s.sessionType === "missed_call_sms" && new Date(s.createdAt).toDateString() === today
  ).length;

  const faqResponses = sessions.filter(
    (s) => s.sessionType === "website_widget" && new Date(s.createdAt).toDateString() === today
  ).length;

  const stats = [
    {
      label: "Conversations today",
      value: conversationsToday,
      sub: `${sessions.length} total`,
      icon: MessageSquare,
      accent: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      label: "Bookings this week",
      value: bookingsThisWeek,
      sub: `${appointments.length} total`,
      icon: CalendarCheck,
      accent: "text-teal-600",
      bg: "bg-teal-50",
    },
    {
      label: "Missed calls today",
      value: missedCalls,
      sub: "handled by AI",
      icon: PhoneMissed,
      accent: "text-rose-500",
      bg: "bg-rose-50",
    },
    {
      label: "FAQ responses today",
      value: faqResponses,
      sub: "website widget",
      icon: Zap,
      accent: "text-violet-500",
      bg: "bg-violet-50",
    },
  ];

  const recentSessions = sessions.slice(0, 6);

  return (
    <div className="p-8 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Dashboard</h1>
        <p className="text-sm text-stone-400 mt-0.5">QYRO Assist — client overview</p>
      </div>

      {fetchError && (
        <div className="mt-4 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-rose-50 border border-rose-100">
          <AlertCircle size={15} className="text-rose-500 shrink-0" />
          <p className="text-sm text-rose-700">
            Could not reach the API — data shown may be incomplete. Make sure the API server is running.
          </p>
        </div>
      )}

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map(({ label, value, sub, icon: Icon, accent, bg }) => (
          <div
            key={label}
            className="bg-white border border-[#E8E6E1] rounded-[14px] p-5 shadow-[0_1px_4px_rgba(0,0,0,0.05)]"
          >
            <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center mb-3`}>
              <Icon size={15} className={accent} strokeWidth={2} />
            </div>
            <p className="text-2xl font-semibold text-stone-900 tabular-nums">{value}</p>
            <p className="text-xs text-stone-500 mt-0.5 font-medium">{label}</p>
            <p className="text-xs text-stone-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Recent conversations */}
      <div className="mt-6 bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#F0EEE9]">
          <p className="text-sm font-medium text-stone-800">Recent conversations</p>
        </div>

        {recentSessions.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-stone-400">No conversations yet. Your AI assistant will handle them here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[#F0EEE9]">
            {recentSessions.map((s) => (
              <li key={s.id} className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-[#FAFAF8] transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                    s.sessionType === "missed_call_sms"
                      ? "bg-rose-50 text-rose-600"
                      : "bg-amber-50 text-amber-700"
                  }`}>
                    {s.sessionType === "missed_call_sms" ? "Missed call" : "Widget"}
                  </span>
                  {s.escalated && (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 shrink-0">
                      Escalated
                    </span>
                  )}
                </div>
                <p className="text-xs text-stone-400 shrink-0">{formatTime(s.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
