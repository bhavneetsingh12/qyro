// QYRO Conversation Compaction — Client Assistant only
// See docs/TOKEN_BUDGET.md — "Conversation compaction" section.
//
// Strategy (every 6 turns):
//   1. Keep system prompt(s) always
//   2. Keep last 3 exchanges (6 messages) verbatim for recency
//   3. Summarize all older messages into a single [Context summary: ...] message
//   4. Log token counts before/after to assistant_sessions
//
// Summary model: cheap (gpt-4o-mini), max 150 output tokens.

import OpenAI from "openai";
import { db } from "@qyro/db";
import { assistantSessions } from "@qyro/db";
import { eq } from "drizzle-orm";
import { getModelForTier } from "./budget";

type Message = OpenAI.Chat.ChatCompletionMessageParam;

const COMPACTION_MODEL      = getModelForTier("cheap");
const MAX_SUMMARY_TOKENS    = 150;
const KEEP_RECENT_EXCHANGES = 3;   // last N user+assistant pairs = N*2 messages

// ─── Token estimate (rough: 1 token ≈ 4 chars) ────────────────────────────────

function estimateTokens(messages: Message[]): number {
  return Math.ceil(
    messages.reduce((sum, m) => {
      const text = typeof m.content === "string" ? m.content : "";
      return sum + text.length;
    }, 0) / 4,
  );
}

// ─── Summarize older turns ─────────────────────────────────────────────────────

async function summarizeOlderTurns(turns: Message[]): Promise<string> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const transcript = turns
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role.toUpperCase()}: ${typeof m.content === "string" ? m.content : ""}`)
    .join("\n");

  const resp = await openai.chat.completions.create({
    model:      COMPACTION_MODEL,
    max_tokens: MAX_SUMMARY_TOKENS,
    messages: [
      {
        role:    "system",
        content: "Summarize this conversation history in 2-3 sentences. Focus on what the customer asked and what was resolved. Be concise.",
      },
      { role: "user", content: transcript },
    ],
  });

  return resp.choices[0]?.message?.content ?? "(summary unavailable)";
}

// ─── Main compaction function ──────────────────────────────────────────────────

export async function compactHistory(params: {
  sessionId: string;
  messages:  Message[];
}): Promise<Message[]> {
  const { sessionId, messages } = params;

  const systemMessages = messages.filter((m) => m.role === "system");
  const convoMessages  = messages.filter((m) => m.role !== "system");

  const keepCount = KEEP_RECENT_EXCHANGES * 2;

  // Nothing to compact — return as-is
  if (convoMessages.length <= keepCount) {
    return messages;
  }

  const tokensBefore = estimateTokens(messages);
  const olderTurns   = convoMessages.slice(0, convoMessages.length - keepCount);
  const recentTurns  = convoMessages.slice(convoMessages.length - keepCount);

  const summaryText = await summarizeOlderTurns(olderTurns);

  const summaryMessage: Message = {
    role:    "user",
    content: `[Context summary: ${summaryText}]`,
  };

  const compacted    = [...systemMessages, summaryMessage, ...recentTurns];
  const tokensAfter  = estimateTokens(compacted);

  // Log compaction counts — fire-and-forget
  db.update(assistantSessions)
    .set({
      tokenCountBeforeComp: tokensBefore,
      tokenCountAfterComp:  tokensAfter,
    })
    .where(eq(assistantSessions.id, sessionId))
    .catch((e) => console.error("[compact] failed to log compaction:", e));

  return compacted;
}

// ─── Turn counter helper ───────────────────────────────────────────────────────

export function shouldCompact(turnCount: number): boolean {
  return turnCount > 0 && turnCount % 6 === 0;
}
