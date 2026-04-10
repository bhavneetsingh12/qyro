import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const product = String(body?.product ?? "lead").trim();

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
    }

    // Log the waitlist signup — a proper waitlist table can be added later.
    // For now this endpoint accepts the submission so the frontend UX works.
    console.log(`[waitlist] signup product=${product} email=${email}`);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
