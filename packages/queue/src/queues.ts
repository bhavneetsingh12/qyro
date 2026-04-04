// QYRO BullMQ Queue Definitions
// All queue names + job types live here. Workers import from this file.

import { Queue } from "bullmq";
import IORedis from "ioredis";

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL is required");
}

export const redis = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
});

// ─── Queue names ──────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  RESEARCH:   "research",
  OUTREACH:   "outreach",
  REPLY:      "reply",
  OUTBOUND_CALL: "outbound_call",
} as const;

// ─── Job payload types ────────────────────────────────────────────────────────

export type ResearchJobData = {
  tenantId:   string;
  prospectId: string;
  domain:     string;
};

export type OutreachJobData = {
  tenantId:   string;
  prospectId: string;
  sequenceId: string;
  channel:    "email" | "sms";
};

export type ReplyJobData = {
  tenantId:  string;
  messageId: string;
  replyText: string;
};

export type OutboundCallJobData = {
  tenantId: string;
  callAttemptId: string;
};

// ─── Queue instances ──────────────────────────────────────────────────────────

export const researchQueue = new Queue<ResearchJobData>(QUEUE_NAMES.RESEARCH, {
  connection: redis,
  defaultJobOptions: {
    attempts:    3,
    backoff:     { type: "exponential", delay: 5_000 },
    removeOnComplete: { count: 100 },
    removeOnFail:     { count: 500 },
  },
});

export const outreachQueue = new Queue<OutreachJobData>(QUEUE_NAMES.OUTREACH, {
  connection: redis,
  defaultJobOptions: {
    attempts:    2,
    backoff:     { type: "fixed", delay: 10_000 },
    removeOnComplete: { count: 100 },
    removeOnFail:     { count: 500 },
  },
});

export const replyQueue = new Queue<ReplyJobData>(QUEUE_NAMES.REPLY, {
  connection: redis,
  defaultJobOptions: {
    attempts:    3,
    backoff:     { type: "exponential", delay: 2_000 },
    removeOnComplete: { count: 200 },
    removeOnFail:     { count: 500 },
  },
});

export const outboundCallQueue = new Queue<OutboundCallJobData>(QUEUE_NAMES.OUTBOUND_CALL, {
  connection: redis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});
