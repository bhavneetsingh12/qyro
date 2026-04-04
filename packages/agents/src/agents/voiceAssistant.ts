import { type AgentResult } from "../runner";
import { runClientAssistant } from "./clientAssistant";

export type VoiceGreetingOutput = {
  reply: string;
  escalate: false;
};

export type VoiceTurnOutput = {
  reply: string;
  escalate: boolean;
  bookingId?: string;
  sessionId: string;
  intent: "question" | "booking_intent" | "escalate" | "unsubscribe";
};

export type VoiceConfirmBookingOutput = {
  reply: string;
  bookingId: string;
  sessionId: string;
};

export type VoiceTransferOutput = {
  reply: string;
  escalate: true;
  transferTo: "staff";
};

export type VoiceAssistantInput = {
  tenantId: string;
  sessionId?: string;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  runId?: string;
};

function toSpeakable(text: string): string {
  const compact = text
    .replace(/\s+/g, " ")
    .replace(/[\n\r]+/g, " ")
    .trim();

  const chunks = compact
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);

  if (chunks.length === 0) return "I can help with that. Could you say that again?";
  return chunks.join(" ");
}

export async function greeting(params: { businessName: string }): Promise<AgentResult<VoiceGreetingOutput>> {
  const reply = `Hi, you've reached ${params.businessName}. I'm an AI assistant and I can help with questions and booking. How can I help you today?`;

  return {
    ok: true,
    data: {
      reply: toSpeakable(reply),
      escalate: false,
    },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      model: "none",
      modelTier: "cheap",
      cached: false,
    },
  };
}

export async function processTurn(input: VoiceAssistantInput): Promise<AgentResult<VoiceTurnOutput>> {
  const result = await runClientAssistant({
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    message: input.message,
    history: input.history,
    sessionType: "website_widget",
    runId: input.runId,
  });

  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      reply: toSpeakable(result.data.reply),
      escalate: result.data.escalate,
      bookingId: result.data.bookingId,
      sessionId: result.data.sessionId,
      intent: result.data.intent,
    },
    usage: result.usage,
  };
}

export async function confirmBooking(params: {
  bookingId: string;
  sessionId: string;
  startAt: string;
  providerName?: string;
}): Promise<AgentResult<VoiceConfirmBookingOutput>> {
  const providerText = params.providerName ? ` with ${params.providerName}` : "";
  const localTime = new Date(params.startAt).toLocaleString("en-US", {
    timeZone: process.env.DEFAULT_TIMEZONE ?? "America/Los_Angeles",
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });

  const reply = `You're booked for ${localTime}${providerText}. Would you like me to repeat that?`;

  return {
    ok: true,
    data: {
      reply: toSpeakable(reply),
      bookingId: params.bookingId,
      sessionId: params.sessionId,
    },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      model: "none",
      modelTier: "cheap",
      cached: false,
    },
  };
}

export async function transferToStaff(): Promise<AgentResult<VoiceTransferOutput>> {
  return {
    ok: true,
    data: {
      reply: "I am connecting you with a team member now.",
      escalate: true,
      transferTo: "staff",
    },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      model: "none",
      modelTier: "cheap",
      cached: false,
    },
  };
}
