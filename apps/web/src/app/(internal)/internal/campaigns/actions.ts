"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const API_URL = process.env.API_URL ?? "http://localhost:3005";

export async function activateCampaignAction(formData: FormData) {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) return;

  const id = formData.get("id") as string;

  await fetch(`${API_URL}/api/campaigns/${id}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  revalidatePath("/internal/campaigns");
}

export async function createCampaignAction(formData: FormData) {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  const name = (formData.get("name") as string)?.trim();
  const niche = (formData.get("niche") as string)?.trim() || undefined;
  const channel = formData.get("channel") as string;
  const promptPackId = (formData.get("promptPackId") as string)?.trim();

  if (!name) return { error: "Name is required" };
  if (!promptPackId) return { error: "Prompt pack ID is required" };

  const res = await fetch(`${API_URL}/api/campaigns`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, niche, channel, promptPackId }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: (body as { message?: string }).message ?? "Failed to create campaign" };
  }

  redirect("/internal/campaigns");
}
