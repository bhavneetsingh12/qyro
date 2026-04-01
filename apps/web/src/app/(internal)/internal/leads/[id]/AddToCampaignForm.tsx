"use client";

import { useFormState, useFormStatus } from "react-dom";
import { addToCampaignAction } from "../actions";

type Campaign = {
  id: string;
  name: string;
  channel: string;
};

type State = { error?: string; success?: boolean } | null;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-sm font-medium px-4 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
    >
      {pending ? "Adding…" : "Add to campaign"}
    </button>
  );
}

export default function AddToCampaignForm({
  leadId,
  campaigns,
}: {
  leadId: string;
  campaigns: Campaign[];
}) {
  const [state, formAction] = useFormState<State, FormData>(
    async (_prev: State, formData: FormData) => addToCampaignAction(formData),
    null,
  );

  if (campaigns.length === 0) {
    return (
      <p className="text-xs text-stone-400">
        No active campaigns — create one first.
      </p>
    );
  }

  if (state?.success) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 bg-teal-50 px-4 py-2 rounded-lg">
        Queued for outreach
      </span>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="leadId" value={leadId} />

      <select
        name="sequenceData"
        className="text-sm text-stone-700 bg-white border border-[#E8E6E1] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-300"
        defaultValue={`${campaigns[0].id}|${campaigns[0].channel}`}
      >
        {campaigns.map((c) => (
          <option key={c.id} value={`${c.id}|${c.channel}`}>
            {c.name} ({c.channel})
          </option>
        ))}
      </select>

      <SubmitButton />

      {state?.error && (
        <p className="text-xs text-rose-500">{state.error}</p>
      )}
    </form>
  );
}
