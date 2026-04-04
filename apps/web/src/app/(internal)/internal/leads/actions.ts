"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

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
  const bypassAuth = process.env.DEV_BYPASS_AUTH === "true";
  if (!token && !bypassAuth) return { error: "Not authenticated" };

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}/api/leads/${leadId}/research`, {
    method: "POST",
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: (body as { message?: string }).message ?? "Failed to enqueue research" };
  }

  revalidatePath(`/internal/leads/${leadId}`);
  revalidatePath("/internal/leads");
  return { success: true };
}

export async function runResearchBatchAction(leadIds: string[]) {
  const ids = Array.from(new Set((leadIds ?? []).map((id) => String(id).trim()).filter(Boolean)));
  if (ids.length === 0) return { error: "No leads selected" };

  const { getToken } = await auth();
  const token = await getToken();
  const bypassAuth = process.env.DEV_BYPASS_AUTH === "true";
  if (!token && !bypassAuth) return { error: "Not authenticated" };

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const results = await Promise.allSettled(
    ids.map(async (leadId) => {
      const res = await fetch(`${API_URL}/api/leads/${leadId}/research`, {
        method: "POST",
        headers,
      });
      if (!res.ok) throw new Error(`Failed to queue research for ${leadId}`);
      return leadId;
    }),
  );

  const queued = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.length - queued;

  revalidatePath("/internal/leads");
  return { success: true, queued, failed };
}
