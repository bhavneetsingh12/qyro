"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Calendar, CalendarX, Plus, Trash2, X } from "lucide-react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://api.qyro.us"
    : "http://localhost:3001");

// ─── Types ────────────────────────────────────────────────────────────────────

type Appointment = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  source: string | null;
  calBookingUid: string | null;
  syncedToProvider: boolean;
  notes: string | null;
  prospectName: string | null;
  prospectPhone: string | null;
};

type BlackoutBlock = {
  id: string;
  label: string;
  startAt: string;
  endAt: string;
  notes: string | null;
  createdAt: string;
  providerBlockId: string | null;
  providerSynced: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDateRange(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    return (
      start.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
      " · " +
      start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) +
      " – " +
      end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    );
  }
  return fmtDateTime(startIso) + " – " + fmtDateTime(endIso);
}

// Local datetime string for <input type="datetime-local">
function toLocalDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const SOURCE_LABELS: Record<string, string> = {
  manual:       "Manual booking",
  chat:         "Website chat",
  voice_swaig:  "AI voice",
  voice_turn:   "AI voice",
  voice_inbound: "Inbound call",
  sms:          "SMS",
};

const STATUS_STYLES: Record<string, string> = {
  confirmed:            "bg-teal-50 text-teal-700",
  proposed:             "bg-amber-50 text-amber-700",
  pending_confirmation: "bg-blue-50 text-blue-700",
  cancelled:            "bg-stone-100 text-stone-400",
  completed:            "bg-stone-100 text-stone-500",
  no_show:              "bg-rose-50 text-rose-500",
};

const STATUS_LABELS: Record<string, string> = {
  confirmed:            "Confirmed",
  proposed:             "Proposed",
  pending_confirmation: "Pending confirmation",
  cancelled:            "Cancelled",
  completed:            "Completed",
  no_show:              "No show",
};

// ─── New Booking Modal ────────────────────────────────────────────────────────

function NewBookingModal({
  onClose,
  onCreated,
  getToken,
}: {
  onClose: () => void;
  onCreated: () => void;
  getToken: () => Promise<string | null>;
}) {
  const defaultStart = toLocalDatetimeValue(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const defaultEnd = toLocalDatetimeValue(new Date(Date.now() + 25 * 60 * 60 * 1000));

  const [form, setForm] = useState({
    callerName: "",
    callerPhone: "",
    callerEmail: "",
    service: "",
    startAt: defaultStart,
    endAt: defaultEnd,
    notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/appointments/manual`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          callerName: form.callerName || undefined,
          callerPhone: form.callerPhone || undefined,
          callerEmail: form.callerEmail || undefined,
          service: form.service || undefined,
          startAt: new Date(form.startAt).toISOString(),
          endAt: new Date(form.endAt).toISOString(),
          notes: form.notes || undefined,
        }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        setError(body.message ?? "Failed to create booking");
        return;
      }

      onCreated();
      onClose();
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-[16px] shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-stone-900">Schedule appointment</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Name</label>
              <input
                type="text"
                value={form.callerName}
                onChange={(e) => setForm((f) => ({ ...f, callerName: e.target.value }))}
                placeholder="Jane Smith"
                className="w-full text-sm border border-[#E8E6E1] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Phone</label>
              <input
                type="tel"
                value={form.callerPhone}
                onChange={(e) => setForm((f) => ({ ...f, callerPhone: e.target.value }))}
                placeholder="+1 555 000 0000"
                className="w-full text-sm border border-[#E8E6E1] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-200"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Email (optional)</label>
            <input
              type="email"
              value={form.callerEmail}
              onChange={(e) => setForm((f) => ({ ...f, callerEmail: e.target.value }))}
              placeholder="jane@example.com"
              className="w-full text-sm border border-[#E8E6E1] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-200"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Service</label>
            <input
              type="text"
              value={form.service}
              onChange={(e) => setForm((f) => ({ ...f, service: e.target.value }))}
              placeholder="e.g. Consultation, Follow-up"
              className="w-full text-sm border border-[#E8E6E1] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Start</label>
              <input
                type="datetime-local"
                value={form.startAt}
                onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))}
                required
                className="w-full text-sm border border-[#E8E6E1] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">End</label>
              <input
                type="datetime-local"
                value={form.endAt}
                onChange={(e) => setForm((f) => ({ ...f, endAt: e.target.value }))}
                required
                className="w-full text-sm border border-[#E8E6E1] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-200"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder="Optional internal notes"
              className="w-full text-sm border border-[#E8E6E1] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-200 resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-rose-500 font-medium">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 text-sm font-medium px-4 py-2 rounded-lg border border-[#E8E6E1] text-stone-600 hover:bg-stone-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 text-sm font-medium px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-700 transition-colors disabled:opacity-50"
            >
              {loading ? "Saving…" : "Schedule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = "appointments" | "availability";

export default function BookingsPage() {
  const { getToken } = useAuth();
  const [tab, setTab] = useState<Tab>("appointments");

  // Appointments state
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [apptLoading, setApptLoading] = useState(true);
  const [apptError, setApptError] = useState(false);
  const [showNewBooking, setShowNewBooking] = useState(false);

  // Blackout state
  const [blocks, setBlocks] = useState<BlackoutBlock[]>([]);
  const [blocksLoading, setBlocksLoading] = useState(true);
  const [blocksError, setBlocksError] = useState(false);
  const [blockForm, setBlockForm] = useState({
    label: "",
    startAt: toLocalDatetimeValue(new Date()),
    endAt: toLocalDatetimeValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    notes: "",
  });
  const [blockSaving, setBlockSaving] = useState(false);
  const [blockFormError, setBlockFormError] = useState<string | null>(null);
  const [blockFormNotice, setBlockFormNotice] = useState<string | null>(null);

  const fetchAppointments = useCallback(async () => {
    setApptLoading(true);
    setApptError(false);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/appointments?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const body = (await res.json()) as { data?: Appointment[] };
        setAppointments(body.data ?? []);
      } else {
        setApptError(true);
      }
    } catch {
      setApptError(true);
    } finally {
      setApptLoading(false);
    }
  }, [getToken]);

  const fetchBlocks = useCallback(async () => {
    setBlocksLoading(true);
    setBlocksError(false);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/assist/blackout-blocks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const body = (await res.json()) as { data?: BlackoutBlock[] };
        setBlocks(body.data ?? []);
      } else {
        setBlocksError(true);
      }
    } catch {
      setBlocksError(true);
    } finally {
      setBlocksLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void fetchAppointments();
  }, [fetchAppointments]);

  useEffect(() => {
    if (tab === "availability") void fetchBlocks();
  }, [tab, fetchBlocks]);

  const handleDeleteBlock = async (blockId: string) => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/assist/blackout-blocks/${blockId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setBlocks((prev) => prev.filter((b) => b.id !== blockId));
      }
    } catch {
      // silent — block stays in list if delete fails
    }
  };

  const handleAddBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setBlockFormError(null);
    setBlockFormNotice(null);
    setBlockSaving(true);

    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/assist/blackout-blocks`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          label: blockForm.label,
          startAt: new Date(blockForm.startAt).toISOString(),
          endAt: new Date(blockForm.endAt).toISOString(),
          notes: blockForm.notes || undefined,
        }),
      });

      const body = (await res.json()) as { message?: string; data?: { providerSynced?: boolean } };

      if (!res.ok) {
        setBlockFormError(body.message ?? "Failed to add block");
        return;
      }

      setBlockForm({
        label: "",
        startAt: toLocalDatetimeValue(new Date()),
        endAt: toLocalDatetimeValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
        notes: "",
      });
      if (body.data?.providerSynced) {
        setBlockFormNotice("Availability block saved and synced to your calendar provider.");
      } else {
        setBlockFormNotice("Availability block saved locally. Provider sync is not configured.");
      }

      await fetchBlocks();
    } catch {
      setBlockFormError("Network error — please try again");
    } finally {
      setBlockSaving(false);
    }
  };

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
      tab === t
        ? "bg-stone-900 text-white"
        : "text-stone-500 hover:text-stone-800 hover:bg-stone-100"
    }`;

  return (
    <div className="p-8 max-w-4xl">
      {showNewBooking && (
        <NewBookingModal
          onClose={() => setShowNewBooking(false)}
          onCreated={fetchAppointments}
          getToken={getToken}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Bookings</h1>
          <p className="text-sm text-stone-400 mt-0.5">Appointments and availability management</p>
        </div>
        {tab === "appointments" && (
          <button
            onClick={() => setShowNewBooking(true)}
            className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-700 transition-colors"
          >
            <Plus size={15} />
            Schedule appointment
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-stone-100 rounded-xl p-1 w-fit">
        <button className={tabClass("appointments")} onClick={() => setTab("appointments")}>
          <span className="flex items-center gap-1.5">
            <Calendar size={14} />
            Appointments
          </span>
        </button>
        <button className={tabClass("availability")} onClick={() => setTab("availability")}>
          <span className="flex items-center gap-1.5">
            <CalendarX size={14} />
            Availability blocks
          </span>
        </button>
      </div>

      {/* ── Appointments tab ─────────────────────────────────────────────── */}
      {tab === "appointments" && (
        <div className="bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
          {apptLoading ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-stone-400">Loading appointments…</p>
            </div>
          ) : apptError ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-rose-500 font-medium">Could not load appointments</p>
              <button onClick={fetchAppointments} className="mt-2 text-xs text-stone-400 underline">
                Retry
              </button>
            </div>
          ) : appointments.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-medium text-stone-700">No appointments yet</p>
              <p className="mt-1 text-sm text-stone-400">
                Your AI assistant will place bookings here, or you can schedule one manually.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="px-5 py-3 border-b border-[#F0EEE9] grid grid-cols-[1fr_auto_auto] gap-6 items-center min-w-[440px]">
                <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">Prospect</p>
                <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">Start time</p>
                <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">Status</p>
              </div>
              <ul className="divide-y divide-[#F0EEE9]">
                {appointments.map((a) => (
                  <li
                    key={a.id}
                    className="px-5 py-3 grid grid-cols-[1fr_auto_auto] gap-6 items-center hover:bg-[#FAFAF8] transition-colors min-w-[440px]"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-800 truncate">
                        {a.prospectName ?? "Unknown"}
                      </p>
                      {a.prospectPhone && (
                        <p className="text-xs text-stone-400 mt-0.5 truncate">{a.prospectPhone}</p>
                      )}
                      {a.source && (
                        <p className="text-xs text-stone-300 mt-0.5 truncate">
                          {SOURCE_LABELS[a.source] ?? a.source.replace(/_/g, " ")}
                        </p>
                      )}
                      <p className={`text-xs mt-0.5 ${a.syncedToProvider ? "text-teal-600" : "text-amber-600"}`}>
                        Calendar sync: {a.syncedToProvider ? "Synced" : "Local only"}
                      </p>
                    </div>
                    <p className="text-sm text-stone-600 shrink-0 tabular-nums">
                      {fmtDateTime(a.startAt)}
                    </p>
                    <span
                      className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full shrink-0 ${
                        STATUS_STYLES[a.status] ?? "bg-stone-100 text-stone-500"
                      }`}
                    >
                      {STATUS_LABELS[a.status] ?? a.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Availability blocks tab ──────────────────────────────────────── */}
      {tab === "availability" && (
        <div className="space-y-5">
          {/* Add block form */}
          <div className="bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] p-5">
            <h2 className="text-sm font-semibold text-stone-800 mb-4">Add availability block</h2>
            <p className="text-xs text-stone-400 mb-4 leading-relaxed">
              Blocks mark a period when your calendar is unavailable. AI booking is prevented during
              any active block. Manual bookings can still be created by staff.
            </p>
            <form onSubmit={handleAddBlock} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Label</label>
                <input
                  type="text"
                  value={blockForm.label}
                  onChange={(e) => setBlockForm((f) => ({ ...f, label: e.target.value }))}
                  required
                  placeholder="e.g. Vacation, Holiday closure, Lunch break"
                  className="w-full text-sm border border-[#E8E6E1] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-200"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">Start</label>
                  <input
                    type="datetime-local"
                    value={blockForm.startAt}
                    onChange={(e) => setBlockForm((f) => ({ ...f, startAt: e.target.value }))}
                    required
                    className="w-full text-sm border border-[#E8E6E1] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">End</label>
                  <input
                    type="datetime-local"
                    value={blockForm.endAt}
                    onChange={(e) => setBlockForm((f) => ({ ...f, endAt: e.target.value }))}
                    required
                    className="w-full text-sm border border-[#E8E6E1] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-200"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Notes (optional)</label>
                <input
                  type="text"
                  value={blockForm.notes}
                  onChange={(e) => setBlockForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. Owner on vacation"
                  className="w-full text-sm border border-[#E8E6E1] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-200"
                />
              </div>
              {blockFormError && (
                <p className="text-xs text-rose-500 font-medium">{blockFormError}</p>
              )}
              {blockFormNotice && (
                <p className="text-xs text-teal-600 font-medium">{blockFormNotice}</p>
              )}
              <button
                type="submit"
                disabled={blockSaving}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-700 transition-colors disabled:opacity-50"
              >
                {blockSaving ? "Adding…" : "Add block"}
              </button>
            </form>
          </div>

          {/* Block list */}
          <div className="bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[#F0EEE9]">
              <p className="text-xs font-medium text-stone-500 uppercase tracking-wide">
                Upcoming blocks
              </p>
            </div>
            {blocksLoading ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-stone-400">Loading…</p>
              </div>
            ) : blocksError ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-rose-500 font-medium">Could not load blocks</p>
                <button onClick={fetchBlocks} className="mt-2 text-xs text-stone-400 underline">
                  Retry
                </button>
              </div>
            ) : blocks.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-stone-400">No upcoming availability blocks</p>
              </div>
            ) : (
              <ul className="divide-y divide-[#F0EEE9]">
                {blocks.map((b) => (
                  <li
                    key={b.id}
                    className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-[#FAFAF8] transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-800">{b.label}</p>
                      <p className="text-xs text-stone-400 mt-0.5">
                        {fmtDateRange(b.startAt, b.endAt)}
                      </p>
                      <p className={`text-xs mt-0.5 ${b.providerSynced ? "text-teal-600" : "text-amber-600"}`}>
                        Provider sync: {b.providerSynced ? "Synced" : "Local only"}
                      </p>
                      {b.notes && (
                        <p className="text-xs text-stone-300 mt-0.5 italic truncate">{b.notes}</p>
                      )}
                    </div>
                    <button
                      onClick={() => void handleDeleteBlock(b.id)}
                      className="shrink-0 text-stone-300 hover:text-rose-400 transition-colors"
                      title="Remove block"
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
