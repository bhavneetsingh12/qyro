"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Save, CheckCircle } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

type SettingsForm = {
  name:               string;
  approvedServices:   string;
  bookingLink:        string;
  emailFromName:      string;
  calendarProvider:   string;
  providersList:      string;
  autoRespond:        boolean;
  autoSendMissedCall: boolean;
  escalationContactPhone: string;
  escalationContactEmail: string;
  businessHours:      string;
  voiceNumber:        string;
  connectionMethod:   string;
};

export default function ClientSettingsPage() {
  const { getToken } = useAuth();

  const [form, setForm] = useState<SettingsForm>({
    name:               "",
    approvedServices:   "",
    bookingLink:        "",
    emailFromName:      "",
    calendarProvider:   "cal_com",
    providersList:      "",
    autoRespond:        false,
    autoSendMissedCall: false,
    escalationContactPhone: "",
    escalationContactEmail: "",
    businessHours:      "",
    voiceNumber:        "",
    connectionMethod:   "forwarding",
  });
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const token = await getToken();
      if (!token) return;
      try {
        const res = await fetch(`${API_URL}/api/v1/tenants/settings`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setForm({
            name:               data.name             ?? "",
            approvedServices:   data.approvedServices ?? "",
            bookingLink:        data.bookingLink      ?? "",
            emailFromName:      data.emailFromName    ?? "",
            calendarProvider:   data.calendarProvider ?? "cal_com",
            providersList:      data.providersList    ?? "",
            autoRespond:        !!data.autoRespond,
            autoSendMissedCall: !!data.autoSendMissedCall,
            escalationContactPhone: data.escalationContactPhone ?? "",
            escalationContactEmail: data.escalationContactEmail ?? "",
            businessHours:      data.businessHours    ?? "",
            voiceNumber:        data.voiceNumber      ?? "",
            connectionMethod:   data.connectionMethod ?? "forwarding",
          });
        }
      } catch {
        // non-fatal — form stays blank
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [getToken]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/tenants/settings`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        setError("Save failed — please try again.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Settings</h1>
        <p className="text-sm text-stone-400 mt-0.5">Business profile and assistant configuration</p>
      </div>

      {loading ? (
        <div className="mt-6 bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] p-6 space-y-5">
          <div className="skeleton h-4 w-32" />
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
            <div key={i} className="space-y-2">
              <div className="skeleton h-3 w-28" />
              <div className="skeleton h-9 w-full" />
              <div className="skeleton h-3 w-48" />
            </div>
          ))}
        </div>
      ) : (
        <form onSubmit={handleSave} className="mt-6 space-y-5">
          <div className="bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] p-6 space-y-5">
            <p className="text-sm font-semibold text-stone-800">Business profile</p>

            <FormField
              label="Business name"
              hint="Shown in AI replies and booking confirmations."
            >
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Acme Plumbing"
              />
            </FormField>

            <FormField
              label="Approved services"
              hint="Comma-separated. The AI uses this to answer 'what do you offer?' questions."
            >
              <input
                className="input"
                value={form.approvedServices}
                onChange={(e) => setForm({ ...form, approvedServices: e.target.value })}
                placeholder="Pipe repair, water heater install, drain cleaning"
              />
            </FormField>

            <FormField
              label="Booking link"
              hint="Clients are sent here when they ask to book an appointment."
            >
              <input
                className="input"
                type="url"
                value={form.bookingLink}
                onChange={(e) => setForm({ ...form, bookingLink: e.target.value })}
                placeholder="https://calendly.com/your-business"
              />
            </FormField>

            <FormField
              label="Calendar provider"
              hint="Select the booking backend used by the assistant."
            >
              <select
                className="input"
                value={form.calendarProvider}
                onChange={(e) => setForm({ ...form, calendarProvider: e.target.value })}
              >
                <option value="cal_com">Cal.com</option>
                <option value="google_calendar">Google Calendar</option>
              </select>
            </FormField>

            <FormField
              label="Providers / staff list"
              hint="Comma-separated staff names shown for provider-aware booking flows."
            >
              <input
                className="input"
                value={form.providersList}
                onChange={(e) => setForm({ ...form, providersList: e.target.value })}
                placeholder="Sarah, Mike, Front Desk"
              />
            </FormField>

            <FormField
              label="Business hours"
              hint="Natural text format used for assistant guidance."
            >
              <input
                className="input"
                value={form.businessHours}
                onChange={(e) => setForm({ ...form, businessHours: e.target.value })}
                placeholder="Mon-Fri 9am-6pm, Sat 10am-2pm"
              />
            </FormField>

            <FormField
              label="Your business phone number"
              hint="Enter your existing business number in E.164 format (e.g. +15035551234). QYRO does not provision numbers — this is the number your customers already call."
            >
              <input
                className="input"
                value={form.voiceNumber}
                onChange={(e) => setForm({ ...form, voiceNumber: e.target.value })}
                placeholder="+15035551234"
              />
            </FormField>

            <FormField
              label="How are you connecting this number?"
              hint={
                form.connectionMethod === "forwarding"
                  ? "Option A: Forward your existing number to the QYRO endpoint shown in your setup instructions. Your carrier or VoIP provider handles the forward — no porting required."
                  : "Option B: If your number is on Twilio or SignalWire, paste your QYRO webhook URL into that number's voice configuration in your provider dashboard."
              }
            >
              <select
                className="input"
                value={form.connectionMethod}
                onChange={(e) => setForm({ ...form, connectionMethod: e.target.value })}
              >
                <option value="forwarding">Call forwarding (landline, mobile, or VoIP)</option>
                <option value="webhook">Webhook (Twilio or SignalWire number)</option>
              </select>
            </FormField>

            <div className="flex items-start gap-3 rounded-lg border border-[#E8E6E1] bg-stone-50 px-3 py-2.5">
              <input
                id="autoRespond"
                type="checkbox"
                checked={form.autoRespond}
                onChange={(e) => setForm({ ...form, autoRespond: e.target.checked })}
                className="mt-0.5"
              />
              <div>
                <label htmlFor="autoRespond" className="text-sm font-medium text-stone-700">Enable auto-respond</label>
                <p className="text-xs text-stone-500 mt-0.5">
                  When enabled, assistant-approved replies can be sent automatically.
                </p>
              </div>
            </div>
          </div>

          {/* Missed Call Behavior */}
          <div className="bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] p-6 space-y-4">
            <p className="text-sm font-semibold text-stone-800">Missed Call Behavior</p>

            <div className="flex items-start gap-3 rounded-lg border border-[#E8E6E1] bg-stone-50 px-3 py-2.5">
              <input
                id="autoSendMissedCall"
                type="checkbox"
                checked={form.autoSendMissedCall}
                onChange={(e) => setForm({ ...form, autoSendMissedCall: e.target.checked })}
                className="mt-0.5"
              />
              <div>
                <label htmlFor="autoSendMissedCall" className="text-sm font-medium text-stone-700">
                  Auto-send missed call SMS
                </label>
                <p className="text-xs text-stone-500 mt-0.5">
                  When enabled, the follow-up SMS is sent instantly when a call is missed.
                </p>
                {form.autoSendMissedCall && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
                    Warning: message will send instantly without approval review.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] p-6 space-y-5">
            <p className="text-sm font-semibold text-stone-800">Notifications</p>

            <FormField
              label="Email from name"
              hint="Display name on AI-sent emails (e.g. 'Acme Plumbing Assistant')."
            >
              <input
                className="input"
                value={form.emailFromName}
                onChange={(e) => setForm({ ...form, emailFromName: e.target.value })}
                placeholder="Acme Plumbing Assistant"
              />
            </FormField>

            <FormField
              label="Escalation contact phone"
              hint="When the assistant escalates, QYRO sends an immediate SMS alert and voice calls can transfer to this number. Use E.164 format."
            >
              <input
                className="input"
                value={form.escalationContactPhone}
                onChange={(e) => setForm({ ...form, escalationContactPhone: e.target.value })}
                placeholder="+15035551234"
              />
            </FormField>

            <FormField
              label="Escalation alert email"
              hint="Optional backup alert destination for escalations."
            >
              <input
                className="input"
                type="email"
                value={form.escalationContactEmail}
                onChange={(e) => setForm({ ...form, escalationContactEmail: e.target.value })}
                placeholder="owner@yourbusiness.com"
              />
            </FormField>
          </div>

          {error && (
            <p className="text-sm text-rose-600">{error}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? "Saving…" : "Save changes"}
            </button>

            {saved && (
              <span className="flex items-center gap-1.5 text-sm text-teal-600 font-medium">
                <CheckCircle size={14} />
                Saved
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-stone-700">{label}</label>
      {children}
      <p className="text-xs text-stone-400">{hint}</p>
    </div>
  );
}
