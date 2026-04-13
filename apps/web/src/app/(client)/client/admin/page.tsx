"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Save, CheckCircle, Plus, Trash2, ExternalLink, Loader2 } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "org" | "voice" | "ai" | "team" | "billing";

type CalendarProvider = "callback_only" | "cal_com" | "calendly" | "google_calendar" | "square_appointments" | "acuity";
type BookingMode = "direct_booking" | "booking_link_sms" | "callback_only";
type AgentProfile = {
  enabled: boolean;
  name: string;
  behaviorHint: string;
  allowBooking: boolean;
  allowEscalation: boolean;
};
type AgentProfiles = {
  inbound: AgentProfile;
  outbound: AgentProfile;
  chat: AgentProfile;
};

type Settings = {
  name: string;
  industry: string;
  timezone: string;
  businessHours: string;
  voiceNumber: string;
  voiceRuntime: "signalwire";
  autoSendMissedCall: boolean;
  escalationContactPhone: string;
  businessDescription: string;
  approvedServices: string;
  greetingScript: string;
  escalationPhrases: string;
  calendarProvider: CalendarProvider;
  bookingMode: BookingMode;
  calendarApiKey: string;
  calendarBookingUrl: string;
  calendarEventTypeId: string;
  hasCalendarApiKey: boolean;
  tcpaStrictMode: boolean;
  agentProfiles: AgentProfiles;
};

type FaqEntry = { question: string; answer: string };

type TeamMember = {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  active: boolean;
};

type BillingInfo = {
  plan: string;
  subscriptionStatus: string;
  trial: { active: boolean; expiresAt: string | null; callsRemaining: number };
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-stone-700">{label}</label>
      {children}
      {hint && <p className="text-xs text-stone-400">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#E8E6E1] rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] p-6 space-y-5">
      <p className="text-sm font-semibold text-stone-800">{title}</p>
      {children}
    </div>
  );
}

function SaveBar({ saving, saved, error }: { saving: boolean; saved: boolean; error: string | null }) {
  return (
    <div className="flex items-center gap-3 pt-2">
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
      {error && <span className="text-sm text-rose-600">{error}</span>}
    </div>
  );
}

// ─── Tab: Organization ────────────────────────────────────────────────────────

function OrgTab({ settings, onChange, onSave, saving, saved, error }: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  error: string | null;
}) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(); }} className="space-y-5">
      <Section title="Organization">
        <Field label="Business name">
          <input className="input" value={settings.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Acme Plumbing" />
        </Field>
        <Field label="Industry" hint="Used to tailor AI responses to your sector.">
          <input className="input" value={settings.industry} onChange={(e) => onChange({ industry: e.target.value })} placeholder="Home services, healthcare, legal…" />
        </Field>
        <Field label="Timezone" hint="Used for scheduling and business hours logic.">
          <select className="input" value={settings.timezone} onChange={(e) => onChange({ timezone: e.target.value })}>
            <option value="">— select timezone —</option>
            <option value="America/Los_Angeles">Pacific Time (PT)</option>
            <option value="America/Denver">Mountain Time (MT)</option>
            <option value="America/Chicago">Central Time (CT)</option>
            <option value="America/New_York">Eastern Time (ET)</option>
            <option value="America/Phoenix">Arizona (no DST)</option>
            <option value="Pacific/Honolulu">Hawaii (HT)</option>
            <option value="America/Anchorage">Alaska (AKT)</option>
          </select>
        </Field>
        <Field label="Business hours" hint="Natural text format, e.g. Mon–Fri 9am–6pm, Sat 10am–2pm">
          <input className="input" value={settings.businessHours} onChange={(e) => onChange({ businessHours: e.target.value })} placeholder="Mon-Fri 9am-6pm, Sat 10am-2pm" />
        </Field>
        <div className="flex items-start gap-3 rounded-lg border border-[#E8E6E1] bg-stone-50 px-3 py-2.5">
          <input
            id="tcpaStrictMode"
            type="checkbox"
            checked={settings.tcpaStrictMode}
            onChange={(e) => onChange({ tcpaStrictMode: e.target.checked })}
            className="mt-0.5"
          />
          <div>
            <label htmlFor="tcpaStrictMode" className="text-sm font-medium text-stone-700">Enable strict TCPA compliance mode</label>
            <p className="text-xs text-stone-500 mt-0.5">
              When enabled, automated outbound voice requires valid written consent records; otherwise attempts are blocked or routed to manual review.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Appointment Booking">
        <p className="text-xs text-stone-500 -mt-2">
          Choose how your AI handles appointment requests. &ldquo;Call back to confirm&rdquo; works for any business — no calendar software needed.
        </p>
        <Field label="Calendar provider">
          <select
            className="input"
            value={settings.calendarProvider}
            onChange={(e) => onChange({ calendarProvider: e.target.value as CalendarProvider, calendarApiKey: "", calendarBookingUrl: "", calendarEventTypeId: "" })}
          >
            <option value="callback_only">None — call back to confirm (default)</option>
            <option value="cal_com">Cal.com</option>
            <option value="calendly">Calendly</option>
            <option value="google_calendar">Google Calendar</option>
            <option value="square_appointments">Square Appointments</option>
            <option value="acuity">Acuity Scheduling</option>
          </select>
        </Field>

        <Field
          label="Booking mode"
          hint="Choose whether QYRO books instantly, sends a booking link, or captures the request for callback."
        >
          <select
            className="input"
            value={settings.bookingMode}
            onChange={(e) => onChange({ bookingMode: e.target.value as BookingMode })}
          >
            <option value="direct_booking">Book instantly in calendar</option>
            <option value="booking_link_sms">Send booking link</option>
            <option value="callback_only">Call back to confirm</option>
          </select>
        </Field>

        {settings.calendarProvider !== "callback_only" && (
          <Field
            label="API key / access token"
            hint={
              settings.calendarProvider === "cal_com"
                ? "Cal.com API key from Settings → Developer → API Keys."
                : settings.calendarProvider === "calendly"
                  ? "Calendly personal access token from app.calendly.com → Integrations → API & Webhooks."
                  : "API key or access token for your calendar provider."
            }
          >
            <input
              className="input font-mono text-sm"
              type="password"
              value={settings.calendarApiKey}
              onChange={(e) => onChange({ calendarApiKey: e.target.value })}
              placeholder={settings.hasCalendarApiKey ? "••••••••  (saved — type to replace)" : "Paste API key here"}
              autoComplete="off"
            />
          </Field>
        )}

        {(settings.calendarProvider === "calendly" || settings.calendarProvider === "acuity" || settings.calendarProvider === "square_appointments") && (
          <Field
            label="Booking URL"
            hint="Your public scheduling link. The AI will text this to callers so they can pick a time."
          >
            <input
              className="input"
              value={settings.calendarBookingUrl}
              onChange={(e) => onChange({ calendarBookingUrl: e.target.value })}
              placeholder="https://calendly.com/your-name/service"
            />
          </Field>
        )}

        {settings.calendarProvider === "cal_com" && (
          <Field
            label="Event type ID"
            hint="Numeric ID from your Cal.com event type URL, e.g. 123456."
          >
            <input
              className="input"
              value={settings.calendarEventTypeId}
              onChange={(e) => onChange({ calendarEventTypeId: e.target.value })}
              placeholder="123456"
            />
          </Field>
        )}

        {settings.calendarProvider === "callback_only" && (
          <div className="rounded-lg border border-[#E8E6E1] bg-stone-50 px-3 py-2.5 text-xs text-stone-500">
            When a caller requests an appointment, your AI will save the request and send an SMS to your escalation number so you can call them back to confirm.
            Make sure your escalation contact phone is set in the Voice tab.
          </div>
        )}
      </Section>

      <SaveBar saving={saving} saved={saved} error={error} />
    </form>
  );
}

// ─── Tab: Voice ───────────────────────────────────────────────────────────────

function VoiceTab({ settings, onChange, onSave, saving, saved, error }: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  error: string | null;
}) {
  function patchProfile(mode: keyof AgentProfiles, patch: Partial<AgentProfile>) {
    onChange({
      agentProfiles: {
        ...settings.agentProfiles,
        [mode]: { ...settings.agentProfiles[mode], ...patch },
      },
    });
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(); }} className="space-y-5">
      <Section title="Voice Configuration">
        <Field label="Voice number (E.164)" hint="Your existing business number, e.g. +15035551234. Forward it to QYRO's inbound webhook.">
          <input className="input" value={settings.voiceNumber} onChange={(e) => onChange({ voiceNumber: e.target.value })} placeholder="+15035551234" />
        </Field>
        <Field label="Voice runtime">
          <input className="input" value="SignalWire" readOnly />
        </Field>
        <Field label="Escalation contact phone" hint="E.164. QYRO calls/SMSes this number when the AI escalates a call.">
          <input className="input" value={settings.escalationContactPhone} onChange={(e) => onChange({ escalationContactPhone: e.target.value })} placeholder="+15035551234" />
        </Field>
        <div className="flex items-start gap-3 rounded-lg border border-[#E8E6E1] bg-stone-50 px-3 py-2.5">
          <input
            id="autoSendMissedCall"
            type="checkbox"
            checked={settings.autoSendMissedCall}
            onChange={(e) => onChange({ autoSendMissedCall: e.target.checked })}
            className="mt-0.5"
          />
          <div>
            <label htmlFor="autoSendMissedCall" className="text-sm font-medium text-stone-700">Auto-send missed call SMS</label>
            <p className="text-xs text-stone-500 mt-0.5">Send a follow-up SMS instantly when a call is missed, without approval review.</p>
            {settings.autoSendMissedCall && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
                Messages will send instantly without approval review.
              </p>
            )}
          </div>
        </div>
      </Section>
      <Section title="Shared Agent Runtime Profiles">
        <p className="text-xs text-stone-500 -mt-2">
          One number, separate behavior policies by mode. SignalWire can reuse shared runtimes while QYRO controls policy here.
        </p>
        {(["inbound", "outbound", "chat"] as const).map((mode) => {
          const profile = settings.agentProfiles[mode];
          return (
            <div key={mode} className="rounded-lg border border-[#E8E6E1] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-stone-800 capitalize">{mode} profile</p>
                <label className="flex items-center gap-2 text-xs text-stone-600">
                  <input
                    type="checkbox"
                    checked={profile.enabled}
                    onChange={(e) => patchProfile(mode, { enabled: e.target.checked })}
                  />
                  Enabled
                </label>
              </div>
              <Field label="Profile name">
                <input className="input" value={profile.name} onChange={(e) => patchProfile(mode, { name: e.target.value })} />
              </Field>
              <Field label="Behavior hint" hint="Injected into runtime policy for this mode. Keep it short and operational.">
                <textarea
                  className="input min-h-[64px] resize-y"
                  value={profile.behaviorHint}
                  onChange={(e) => patchProfile(mode, { behaviorHint: e.target.value })}
                />
              </Field>
              <div className="flex gap-4 text-xs text-stone-600">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={profile.allowBooking}
                    onChange={(e) => patchProfile(mode, { allowBooking: e.target.checked })}
                  />
                  Allow booking
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={profile.allowEscalation}
                    onChange={(e) => patchProfile(mode, { allowEscalation: e.target.checked })}
                  />
                  Allow escalation
                </label>
              </div>
            </div>
          );
        })}
      </Section>
      <SaveBar saving={saving} saved={saved} error={error} />
    </form>
  );
}

// ─── Tab: AI Behavior ─────────────────────────────────────────────────────────

function AITab({
  settings, onChange, onSave, saving, saved, error,
  faq, onFaqChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  error: string | null;
  faq: FaqEntry[];
  onFaqChange: (faq: FaqEntry[]) => void;
}) {
  function addFaq() {
    onFaqChange([...faq, { question: "", answer: "" }]);
  }
  function removeFaq(i: number) {
    onFaqChange(faq.filter((_, idx) => idx !== i));
  }
  function updateFaq(i: number, patch: Partial<FaqEntry>) {
    onFaqChange(faq.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(); }} className="space-y-5">
      <Section title="Business Context">
        <Field label="Business description" hint="2–4 sentences. The AI uses this to answer 'what do you do?' questions.">
          <textarea
            className="input min-h-[80px] resize-y"
            value={settings.businessDescription}
            onChange={(e) => onChange({ businessDescription: e.target.value })}
            placeholder="We're a licensed plumbing company serving Portland, OR. We handle emergency repairs, water heater installation, and drain cleaning…"
          />
        </Field>
        <Field label="Services offered" hint="Comma-separated. Used when callers ask what you offer.">
          <input className="input" value={settings.approvedServices} onChange={(e) => onChange({ approvedServices: e.target.value })} placeholder="Pipe repair, water heater install, drain cleaning" />
        </Field>
        <Field label="Greeting script" hint="What the AI says when answering a call. Keep it under 20 words.">
          <input className="input" value={settings.greetingScript} onChange={(e) => onChange({ greetingScript: e.target.value })} placeholder="Thanks for calling Acme Plumbing! How can I help you today?" />
        </Field>
        <Field label="Escalation trigger phrases" hint="Comma-separated phrases. When a caller says these, the AI will escalate.">
          <input className="input" value={settings.escalationPhrases} onChange={(e) => onChange({ escalationPhrases: e.target.value })} placeholder="speak to a person, talk to someone, manager, emergency" />
        </Field>
      </Section>

      <Section title="FAQ Entries">
        <p className="text-xs text-stone-500 -mt-2">Add common questions and answers. The AI uses these verbatim when a caller asks a matching question.</p>
        {faq.length === 0 && (
          <p className="text-sm text-stone-400 italic">No FAQ entries yet. Add one below.</p>
        )}
        {faq.map((entry, i) => (
          <div key={i} className="rounded-lg border border-[#E8E6E1] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-stone-500">FAQ #{i + 1}</span>
              <button type="button" onClick={() => removeFaq(i)} className="text-rose-500 hover:text-rose-700 transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
            <Field label="Question">
              <input className="input" value={entry.question} onChange={(e) => updateFaq(i, { question: e.target.value })} placeholder="What are your hours?" />
            </Field>
            <Field label="Answer">
              <textarea className="input min-h-[60px] resize-y" value={entry.answer} onChange={(e) => updateFaq(i, { answer: e.target.value })} placeholder="We're open Monday through Friday, 9am to 6pm." />
            </Field>
          </div>
        ))}
        <button
          type="button"
          onClick={addFaq}
          className="flex items-center gap-1.5 text-sm font-medium text-amber-600 hover:text-amber-700 transition-colors"
        >
          <Plus size={14} />
          Add FAQ entry
        </button>
      </Section>

      <SaveBar saving={saving} saved={saved} error={error} />
    </form>
  );
}

// ─── Tab: Team ────────────────────────────────────────────────────────────────

const ROLE_OPTIONS = ["owner", "admin", "operator", "sales_rep", "analyst", "client_viewer"] as const;

function TeamTab({ getToken }: { getToken: () => Promise<string | null> }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("operator");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadMembers() {
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/v1/tenants/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const body = await res.json() as { data: TeamMember[] };
        setMembers(body.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadMembers(); }, []);

  async function updateMember(userId: string, patch: { role?: string; active?: boolean }) {
    setSavingId(userId);
    setError(null);
    try {
      const token = await getToken();
      await fetch(`${API_URL}/api/v1/tenants/users/${userId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await loadMembers();
    } catch {
      setError("Save failed");
    } finally {
      setSavingId(null);
    }
  }

  async function inviteMember() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteMsg(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/tenants/users/invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const body = await res.json() as { ok?: boolean; message?: string };
      if (res.ok && body.ok) {
        setInviteMsg("Invitation sent.");
        setInviteEmail("");
        await loadMembers();
      } else {
        setInviteMsg(body.message ?? "Invite failed.");
      }
    } catch {
      setInviteMsg("Network error.");
    } finally {
      setInviting(false);
    }
  }

  if (loading) return <div className="text-sm text-stone-500">Loading team…</div>;

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <Section title="Team Members">
        {members.length === 0 && <p className="text-sm text-stone-400 italic">No team members yet.</p>}
        <div className="space-y-3">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-lg border border-[#E8E6E1] p-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-800 truncate">{m.name ?? m.email ?? m.id}</p>
                {m.name && <p className="text-xs text-stone-400 truncate">{m.email}</p>}
              </div>
              <select
                className="input w-36 text-xs"
                value={m.role}
                disabled={savingId === m.id}
                onChange={(e) => void updateMember(m.id, { role: e.target.value })}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={savingId === m.id}
                onClick={() => void updateMember(m.id, { active: !m.active })}
                className={`text-xs px-2 py-1 rounded font-medium transition-colors ${
                  m.active
                    ? "bg-stone-100 text-stone-600 hover:bg-rose-50 hover:text-rose-600"
                    : "bg-teal-50 text-teal-700 hover:bg-teal-100"
                }`}
              >
                {savingId === m.id ? <Loader2 size={12} className="animate-spin" /> : m.active ? "Deactivate" : "Activate"}
              </button>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Invite Team Member">
        <Field label="Email address">
          <input
            className="input"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="colleague@business.com"
          />
        </Field>
        <Field label="Role">
          <select className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </Field>
        {inviteMsg && <p className="text-sm text-stone-600">{inviteMsg}</p>}
        <button
          type="button"
          disabled={inviting || !inviteEmail.trim()}
          onClick={() => void inviteMember()}
          className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {inviting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Send invitation
        </button>
      </Section>
    </div>
  );
}

// ─── Tab: Billing ─────────────────────────────────────────────────────────────

function BillingTab({ billing, getToken }: { billing: BillingInfo | null; getToken: () => Promise<string | null> }) {
  const [opening, setOpening] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  async function openPortal() {
    setOpening(true);
    setPortalError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/billing/portal-session`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const body = await res.json() as { data?: { url?: string }; message?: string };
      if (!res.ok || !body.data?.url) throw new Error(body.message ?? "Could not open billing portal");
      window.location.href = body.data.url;
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : "Could not open billing portal");
      setOpening(false);
    }
  }

  return (
    <div className="space-y-5">
      <Section title="Current Plan">
        {billing ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-stone-900 capitalize">{billing.plan || "Starter"}</p>
                <p className="text-xs text-stone-500 capitalize">Status: {billing.subscriptionStatus || "active"}</p>
              </div>
            </div>
            {billing.trial.active && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                <p className="text-xs font-medium text-amber-800">Trial active</p>
                <p className="text-xs text-amber-700">
                  {billing.trial.callsRemaining} calls remaining
                  {billing.trial.expiresAt && ` · expires ${new Date(billing.trial.expiresAt).toLocaleDateString()}`}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-stone-400">Loading billing info…</p>
        )}
      </Section>

      <Section title="Manage Billing">
        <p className="text-sm text-stone-500">Update payment method, download invoices, or cancel your subscription.</p>
        {portalError && <p className="text-sm text-rose-600">{portalError}</p>}
        <button
          type="button"
          disabled={opening}
          onClick={() => void openPortal()}
          className="flex items-center gap-2 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {opening ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
          {opening ? "Opening portal…" : "Manage billing"}
        </button>
      </Section>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: Settings = {
  name: "",
  industry: "",
  timezone: "",
  businessHours: "",
  voiceNumber: "",
  voiceRuntime: "signalwire",
  autoSendMissedCall: false,
  escalationContactPhone: "",
  businessDescription: "",
  approvedServices: "",
  greetingScript: "",
  escalationPhrases: "",
  calendarProvider: "callback_only",
  bookingMode: "callback_only",
  calendarApiKey: "",
  calendarBookingUrl: "",
  calendarEventTypeId: "",
  hasCalendarApiKey: false,
  tcpaStrictMode: false,
  agentProfiles: {
    inbound: {
      enabled: true,
      name: "Inbound Receptionist",
      behaviorHint: "Prioritize answering questions, booking, and escalations for incoming callers.",
      allowBooking: true,
      allowEscalation: true,
    },
    outbound: {
      enabled: true,
      name: "Outbound Prospector",
      behaviorHint: "Be concise, qualify quickly, and keep outbound calls focused.",
      allowBooking: false,
      allowEscalation: true,
    },
    chat: {
      enabled: true,
      name: "Website Chat Assistant",
      behaviorHint: "Answer FAQs quickly and capture intent clearly.",
      allowBooking: true,
      allowEscalation: true,
    },
  },
};

const TABS: { key: Tab; label: string }[] = [
  { key: "org",     label: "Organization" },
  { key: "voice",   label: "Voice" },
  { key: "ai",      label: "AI Behavior" },
  { key: "team",    label: "Team" },
  { key: "billing", label: "Billing" },
];

export default function ClientAdminPage() {
  const { getToken } = useAuth();
  const [tab, setTab] = useState<Tab>("org");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [faq, setFaq] = useState<FaqEntry[]>([]);
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const token = await getToken();
      if (!token) return;
      try {
        const [settingsRes, faqRes] = await Promise.all([
          fetch(`${API_URL}/api/v1/tenants/settings`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_URL}/api/v1/tenants/faq`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        if (settingsRes.ok) {
          const d = await settingsRes.json() as Record<string, unknown>;
          setSettings({
            name:                  String(d.name ?? ""),
            industry:              String(d.industry ?? ""),
            timezone:              String(d.timezone ?? ""),
            businessHours:         String(d.businessHours ?? ""),
            voiceNumber:           String(d.voiceNumber ?? ""),
            voiceRuntime:          "signalwire",
            autoSendMissedCall:    Boolean(d.autoSendMissedCall),
            escalationContactPhone: String(d.escalationContactPhone ?? ""),
            businessDescription:   String(d.businessDescription ?? ""),
            approvedServices:      String(d.approvedServices ?? ""),
            greetingScript:        String(d.greetingScript ?? ""),
            escalationPhrases:     String(d.escalationPhrases ?? ""),
            calendarProvider:      (d.calendarProvider as CalendarProvider) ?? "callback_only",
            bookingMode:           (d.bookingMode as BookingMode) ?? "callback_only",
            calendarApiKey:        "",
            calendarBookingUrl:    String(d.calendarBookingUrl ?? ""),
            calendarEventTypeId:   String(d.calendarEventTypeId ?? ""),
            hasCalendarApiKey:     Boolean(d.hasCalendarApiKey),
            tcpaStrictMode:        d.tcpaStrictMode === true,
            agentProfiles:         (d.agentProfiles as AgentProfiles) ?? DEFAULT_SETTINGS.agentProfiles,
          });
          setBilling({
            plan: String(d.plan ?? ""),
            subscriptionStatus: String(d.subscriptionStatus ?? ""),
            trial: (d.trial as BillingInfo["trial"]) ?? { active: false, expiresAt: null, callsRemaining: 0 },
          });
        }

        if (faqRes.ok) {
          const faqBody = await faqRes.json() as { faq?: FaqEntry[] };
          setFaq(faqBody.faq ?? []);
        }
      } finally {
        setLoadingSettings(false);
      }
    }
    void load();
  }, [getToken]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");

      const [settingsRes, faqRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/tenants/settings`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(settings),
        }),
        fetch(`${API_URL}/api/v1/tenants/faq`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ faq }),
        }),
      ]);

      if (!settingsRes.ok || !faqRes.ok) throw new Error("Save failed — please try again.");

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loadingSettings) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="h-7 w-32 skeleton mb-6" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  const patch = (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p }));

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-stone-900">Admin</h1>
        <p className="text-sm text-stone-400 mt-0.5">Organization, voice, AI behavior, team, and billing.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-[#E8E6E1]">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors -mb-px border-b-2 ${
              tab === key
                ? "border-amber-500 text-amber-600 bg-white"
                : "border-transparent text-stone-500 hover:text-stone-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "org" && (
        <OrgTab settings={settings} onChange={patch} onSave={handleSave} saving={saving} saved={saved} error={saveError} />
      )}
      {tab === "voice" && (
        <VoiceTab settings={settings} onChange={patch} onSave={handleSave} saving={saving} saved={saved} error={saveError} />
      )}
      {tab === "ai" && (
        <AITab
          settings={settings} onChange={patch} onSave={handleSave}
          saving={saving} saved={saved} error={saveError}
          faq={faq} onFaqChange={setFaq}
        />
      )}
      {tab === "team" && <TeamTab getToken={getToken} />}
      {tab === "billing" && <BillingTab billing={billing} getToken={getToken} />}
    </div>
  );
}
