"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

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

export async function runSingleResearchSubmitAction(leadId: string): Promise<void> {
  const normalizedLeadId = String(leadId ?? "").trim();
  if (!normalizedLeadId) return;

  await runResearchAction(normalizedLeadId);
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

export async function runOutreachBatchAction(formData: FormData): Promise<void> {
  const ids = Array.from(new Set(formData.getAll("leadIds").map((id) => String(id).trim()).filter(Boolean)));
  if (ids.length === 0) return;

  const sequenceData = String(formData.get("sequenceData") ?? "").trim();
  if (!sequenceData) return;

  const [sequenceId, channel] = sequenceData.split("|");
  if (!sequenceId || (channel !== "email" && channel !== "sms")) {
    return;
  }

  const { getToken } = await auth();
  const token = await getToken();
  const bypassAuth = process.env.DEV_BYPASS_AUTH === "true";
  if (!token && !bypassAuth) return;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const results = await Promise.allSettled(
    ids.map(async (leadId) => {
      const res = await fetch(`${API_URL}/api/leads/${leadId}/outreach`, {
        method: "POST",
        headers,
        body: JSON.stringify({ sequenceId, channel }),
      });
      if (!res.ok) throw new Error(`Failed to enqueue outreach for ${leadId}`);
      return leadId;
    }),
  );

  const queued = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.length - queued;
  console.info("[leads] outreach batch result", { queued, failed, total: ids.length });

  revalidatePath("/internal/leads");
}

export async function runOutboundBatchAction(formData: FormData): Promise<void> {
  const ids = Array.from(new Set(formData.getAll("leadIds").map((id) => String(id).trim()).filter(Boolean)));
  if (ids.length === 0) return;

  const { getToken } = await auth();
  const token = await getToken();
  const bypassAuth = process.env.DEV_BYPASS_AUTH === "true";
  if (!token && !bypassAuth) return;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}/api/v1/assist/outbound-calls/enqueue`, {
    method: "POST",
    headers,
    body: JSON.stringify({ prospectIds: ids }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error("[leads] failed outbound enqueue", body);
    return;
  }

  revalidatePath("/internal/leads");
  revalidatePath("/client/call-control");
  revalidatePath("/client/calls");
  revalidatePath("/client/outbound-pipeline");
}
