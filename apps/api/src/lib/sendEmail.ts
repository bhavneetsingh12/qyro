// QYRO sendEmail — Resend REST API
// No SDK dependency — uses native fetch.
// Requires: RESEND_API_KEY + EMAIL_FROM in env.

export type SendEmailParams = {
  to:      string;
  subject: string;
  html:    string;
  from?:   string;  // overrides EMAIL_FROM env var
};

export type SendEmailResult =
  | { ok: true;  messageId: string }
  | { ok: false; error: string };

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[sendEmail] RESEND_API_KEY is not set");
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const from = params.from ?? process.env.EMAIL_FROM ?? "noreply@qyro.ai";

  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to:      params.to,
        subject: params.subject,
        html:    params.html,
      }),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    return { ok: false, error: `Resend error ${res.status}: ${body}` };
  }

  const data = await res.json() as { id: string };
  return { ok: true, messageId: data.id };
}
