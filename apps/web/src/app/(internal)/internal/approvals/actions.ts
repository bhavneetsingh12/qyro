"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

const API_URL = process.env.API_URL ?? (process.env.NODE_ENV === "production" ? "https://api.qyro.us" : "http://localhost:3001");

export async function approveMessageAction(sequenceId: string, messageId: string) {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  const res = await fetch(
    `${API_URL}/api/campaigns/${sequenceId}/approve/${messageId}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: (body as { message?: string }).message ?? "Failed to approve" };
  }

  revalidatePath("/internal/approvals");
  return { ok: true };
}

export async function rejectMessageAction(
  sequenceId: string,
  messageId: string,
  reason: string,
) {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  const res = await fetch(
    `${API_URL}/api/campaigns/${sequenceId}/reject/${messageId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: reason.trim() || undefined }),
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: (body as { message?: string }).message ?? "Failed to reject" };
  }

  revalidatePath("/internal/approvals");
  return { ok: true };
}
