"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

const API_URL = process.env.API_URL ?? "http://localhost:3005";

export async function addToCampaignAction(formData: FormData) {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  const leadId = formData.get("leadId") as string;
  const sequenceData = formData.get("sequenceData") as string;

  if (!sequenceData) return { error: "No campaign selected" };

  const [sequenceId, channel] = sequenceData.split("|");

  const res = await fetch(`${API_URL}/api/leads/${leadId}/outreach`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sequenceId, channel }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: (body as { message?: string }).message ?? "Failed to enqueue outreach" };
  }

  revalidatePath(`/internal/leads/${leadId}`);
  return { success: true };
}

export async function runResearchAction(leadId: string) {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  const res = await fetch(`${API_URL}/api/leads/${leadId}/research`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: (body as { message?: string }).message ?? "Failed to enqueue research" };
  }

  revalidatePath(`/internal/leads/${leadId}`);
  return { success: true };
}
