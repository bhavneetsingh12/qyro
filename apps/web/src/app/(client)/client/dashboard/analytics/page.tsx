"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

type DailyRow = {
  date: string;
  newProspectsCount: number;
  callsHandledCount: number;
  appointmentsBookedCount: number;
  escalationsCount: number;
  avgUrgencyScore: number | null;
};

type AnalyticsResponse = {
  data: {
    days: number;
    rows: DailyRow[];
    totals: {
      callsHandled: number;
      appointmentsBooked: number;
      escalations: number;
      avgUrgencyScore: number | null;
    };
  };
};

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function lastNDays(days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export default function ClientAnalyticsPage() {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [totals, setTotals] = useState<AnalyticsResponse["data"]["totals"]>({
    callsHandled: 0,
    appointmentsBooked: 0,
    escalations: 0,
    avgUrgencyScore: null,
  });

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) {
          setError("Authentication required.");
          return;
        }

        const res = await fetch(`${API_URL}/api/v1/assist/analytics?days=30`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        if (!res.ok) {
          setError("Failed to load analytics data.");
          return;
        }

        const json = (await res.json()) as AnalyticsResponse;
        const apiRows = json.data?.rows ?? [];
        const byDate = new Map(apiRows.map((row) => [row.date, row]));
        const padded = lastNDays(30).map((date) => {
          const row = byDate.get(date);
          return {
            date,
            newProspectsCount: Number(row?.newProspectsCount ?? 0),
            callsHandledCount: Number(row?.callsHandledCount ?? 0),
            appointmentsBookedCount: Number(row?.appointmentsBookedCount ?? 0),
            escalationsCount: Number(row?.escalationsCount ?? 0),
            avgUrgencyScore: row?.avgUrgencyScore ?? null,
          };
        });

        setRows(padded);
        setTotals(json.data?.totals ?? {
          callsHandled: 0,
          appointmentsBooked: 0,
          escalations: 0,
          avgUrgencyScore: null,
        });
      } catch {
        setError("Network error while loading analytics.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [getToken]);

  const summarySentence = useMemo(() => {
    return `AI handled ${totals.callsHandled} calls, booked ${totals.appointmentsBooked} appointments, and escalated ${totals.escalations} this month.`;
  }, [totals]);

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Analytics</h1>
        <p className="text-sm text-stone-500 mt-1">Last 30 days performance snapshot</p>
      </div>

      <div className="rounded-xl border border-[#E8E6E1] bg-white px-5 py-4 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
        <p className="text-sm text-stone-700">{summarySentence}</p>
      </div>

      {loading ? (
        <div className="rounded-xl border border-[#E8E6E1] bg-white p-5 text-sm text-stone-500">Loading analytics...</div>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">{error}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-[#E8E6E1] bg-white p-5">
              <p className="text-xs text-stone-500 uppercase tracking-wide">Appointments booked</p>
              <p className="text-2xl font-semibold text-stone-900 mt-2">{totals.appointmentsBooked}</p>
            </div>
            <div className="rounded-xl border border-[#E8E6E1] bg-white p-5">
              <p className="text-xs text-stone-500 uppercase tracking-wide">Escalations</p>
              <p className="text-2xl font-semibold text-stone-900 mt-2">{totals.escalations}</p>
            </div>
            <div className="rounded-xl border border-[#E8E6E1] bg-white p-5">
              <p className="text-xs text-stone-500 uppercase tracking-wide">Avg urgency score</p>
              <p className="text-2xl font-semibold text-stone-900 mt-2">
                {totals.avgUrgencyScore ?? "—"}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[#E8E6E1] bg-white p-5">
            <p className="text-sm font-medium text-stone-800 mb-4">Prospects found per day</p>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#EFEDE8" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 12, fill: "#78716c" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#78716c" }} />
                  <Tooltip labelFormatter={(value) => dayLabel(String(value))} />
                  <Line type="monotone" dataKey="newProspectsCount" stroke="#b45309" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-[#E8E6E1] bg-white p-5">
            <p className="text-sm font-medium text-stone-800 mb-4">Calls handled per day</p>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#EFEDE8" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 12, fill: "#78716c" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#78716c" }} />
                  <Tooltip labelFormatter={(value) => dayLabel(String(value))} />
                  <Bar dataKey="callsHandledCount" fill="#0f766e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
