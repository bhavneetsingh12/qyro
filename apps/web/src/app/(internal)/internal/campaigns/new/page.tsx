"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createCampaignAction } from "../actions";

type State = { error?: string } | null;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-sm font-medium px-5 py-2.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
    >
      {pending ? "Creating…" : "Create campaign"}
    </button>
  );
}

const PROMPT_PACKS = [
  { id: "medspa_email_v1",        label: "MedSpa — Email outreach v1" },
  { id: "dental_email_v1",        label: "Dental — Email outreach v1" },
  { id: "chiro_email_v1",         label: "Chiropractic — Email outreach v1" },
  { id: "hvac_email_v1",          label: "HVAC — Email outreach v1" },
  { id: "medspa_missed_call_v1",  label: "MedSpa — Missed call SMS v1" },
  { id: "dental_missed_call_v1",  label: "Dental — Missed call SMS v1" },
];

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-sm font-medium text-stone-700 mb-1.5">
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full text-sm text-stone-800 bg-white border border-[#E8E6E1] rounded-lg px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-300 placeholder:text-stone-300"
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="w-full text-sm text-stone-800 bg-white border border-[#E8E6E1] rounded-lg px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
    />
  );
}

export default function NewCampaignPage() {
  const [state, formAction] = useFormState<State, FormData>(
    async (_prev: State, formData: FormData) => createCampaignAction(formData),
    null,
  );

  return (
    <div className="p-8 max-w-xl">
      <nav className="flex items-center gap-1.5 text-xs text-stone-400 mb-6">
        <Link href="/internal/campaigns" className="hover:text-stone-600 transition-colors">
          Campaigns
        </Link>
        <ChevronRight size={12} className="text-stone-300" />
        <span className="text-stone-600">New campaign</span>
      </nav>

      <h1 className="text-xl font-semibold text-stone-900">New campaign</h1>
      <p className="text-sm text-stone-400 mt-0.5 mb-6">
        Define an outreach sequence. Campaigns start inactive — activate after review.
      </p>

      <form action={formAction} className="space-y-5">
        {/* Name */}
        <div>
          <Label>Campaign name *</Label>
          <Input
            name="name"
            required
            placeholder="e.g. MedSpa Email Q1"
          />
        </div>

        {/* Niche */}
        <div>
          <Label>Niche</Label>
          <Input
            name="niche"
            placeholder="e.g. medspa, dental, chiropractic"
          />
          <p className="text-xs text-stone-400 mt-1">
            Used to match leads automatically
          </p>
        </div>

        {/* Channel */}
        <div>
          <Label>Channel *</Label>
          <Select name="channel" defaultValue="email">
            <option value="email">Email</option>
            <option value="sms">SMS</option>
          </Select>
        </div>

        {/* Prompt pack */}
        <div>
          <Label>Prompt pack *</Label>
          <Select name="promptPackId" defaultValue="">
            <option value="" disabled>
              Select a prompt pack…
            </option>
            {PROMPT_PACKS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-stone-400 mt-1">
            Must match a prompt pack ID in{" "}
            <span className="font-mono">docs/PROMPTS/</span>
          </p>
        </div>

        {/* Error */}
        {state?.error && (
          <div className="bg-rose-50 border border-rose-100 rounded-lg px-4 py-3">
            <p className="text-sm text-rose-600">{state.error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <SubmitButton />
          <Link
            href="/internal/campaigns"
            className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
