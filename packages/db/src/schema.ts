// QYRO Database Schema — Drizzle ORM
// RULE: every table has tenant_id. Never query without it.
// Run: pnpm db:generate && pnpm db:migrate

import {
  pgTable, uuid, text, integer, boolean, jsonb,
  timestamp, pgEnum, index, uniqueIndex
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const planEnum = pgEnum("plan", ["starter", "growth", "agency"]);
export const roleEnum = pgEnum("role", ["owner", "admin", "operator", "sales_rep", "analyst", "client_viewer"]);
export const consentStateEnum = pgEnum("consent_state", ["unknown", "given", "denied", "revoked"]);
export const messageStatusEnum = pgEnum("message_status", [
  "draft", "pending_approval", "approved", "sent", "failed",
  "blocked_by_qa", "bounced", "replied"
]);
export const channelEnum = pgEnum("channel", ["email", "sms", "voice"]);
export const classificationEnum = pgEnum("classification", [
  "interested", "neutral", "not_now", "unsubscribe", "angry", "question"
]);
export const appointmentStatusEnum = pgEnum("appointment_status", [
  "proposed", "confirmed", "cancelled", "completed", "no_show"
]);
export const agentEnum = pgEnum("agent_name", [
  "lead_discovery", "research", "outreach", "reply_triage",
  "booking", "client_assistant", "qa_guardrail", "prompt_hygiene"
]);
export const modelTierEnum = pgEnum("model_tier", ["cheap", "standard", "premium"]);

// ─── Core tenant/user tables ──────────────────────────────────────────────────

export const tenants = pgTable("tenants", {
  id:           uuid("id").primaryKey().defaultRandom(),
  name:         text("name").notNull(),
  slug:         text("slug").notNull().unique(),
  plan:         text("plan").notNull().default("starter"),
  active:       boolean("active").notNull().default(true),
  metadata:     jsonb("metadata").default({}),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
});

export const users = pgTable("users", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  clerkId:      text("clerk_id").notNull().unique(),
  email:        text("email").notNull(),
  name:         text("name"),
  role:         text("role").notNull().default("sales_rep"),
  active:       boolean("active").notNull().default(true),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx:    index("users_tenant_idx").on(t.tenantId),
}));

export const plans = pgTable("plans", {
  id:                uuid("id").primaryKey().defaultRandom(),
  name:              text("name").notNull().unique(),
  dailyInputTokens:  integer("daily_input_tokens").notNull(),
  dailyOutputTokens: integer("daily_output_tokens").notNull(),
  maxSeats:          integer("max_seats").notNull(),
  priceMonthly:      integer("price_monthly").notNull(), // cents
  setupFee:          integer("setup_fee").notNull().default(0), // cents
});

// ─── Lead / prospect tables ───────────────────────────────────────────────────

export const prospectsRaw = pgTable("prospects_raw", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  source:         text("source").notNull(),           // "apollo" | "places_api" | "inbound_form"
  sourceId:       text("source_id"),                  // external ID from source
  businessName:   text("business_name").notNull(),
  domain:         text("domain"),
  phone:          text("phone"),
  email:          text("email"),
  address:        text("address"),
  niche:          text("niche"),
  consentState:   text("consent_state").notNull().default("unknown"),
  deduped:        boolean("deduped").notNull().default(false),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx:      index("prospects_raw_tenant_idx").on(t.tenantId),
  domainIdx:      index("prospects_raw_domain_idx").on(t.tenantId, t.domain),
}));

export const prospectsEnriched = pgTable("prospects_enriched", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  prospectId:     uuid("prospect_id").notNull().references(() => prospectsRaw.id),
  summary:        text("summary"),
  painPoints:     jsonb("pain_points").default([]),   // string[]
  pitchAngles:    jsonb("pitch_angles").default([]),  // string[]
  urgencyScore:   integer("urgency_score"),           // 1-10
  fromCache:      boolean("from_cache").notNull().default(false),
  researchedAt:   timestamp("researched_at").defaultNow().notNull(),
  cacheKey:       text("cache_key"),
}, (t) => ({
  prospectIdx:    uniqueIndex("enriched_prospect_idx").on(t.tenantId, t.prospectId),
}));

export const leadScores = pgTable("lead_scores", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull().references(() => tenants.id),
  prospectId:     uuid("prospect_id").notNull().references(() => prospectsRaw.id),
  score:          integer("score").notNull(),
  model:          text("model").notNull(),
  scoredAt:       timestamp("scored_at").defaultNow().notNull(),
});

// ─── Outreach / messaging ─────────────────────────────────────────────────────

export const outreachSequences = pgTable("outreach_sequences", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name:           text("name").notNull(),
  niche:          text("niche"),
  channel:        text("channel").notNull(),
  promptPackId:   text("prompt_pack_id").notNull(),  // matches id in .md frontmatter
  active:         boolean("active").notNull().default(false),
  approvedBy:     uuid("approved_by").references(() => users.id),
  approvedAt:     timestamp("approved_at"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx:      index("sequences_tenant_idx").on(t.tenantId),
}));

export const messageAttempts = pgTable("message_attempts", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  sequenceId:     uuid("sequence_id").references(() => outreachSequences.id),
  prospectId:     uuid("prospect_id").notNull().references(() => prospectsRaw.id),
  channel:        text("channel").notNull(),
  direction:      text("direction").notNull().default("outbound"), // "outbound" | "inbound"
  messageText:    text("message_text"),
  status:         text("status").notNull().default("draft"),
  qaVerdict:      text("qa_verdict"),                // "pass" | "block"
  qaFlags:        jsonb("qa_flags").default([]),
  classification: text("classification"),
  externalId:     text("external_id"),               // provider message ID
  sentAt:         timestamp("sent_at"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx:      index("messages_tenant_idx").on(t.tenantId),
  prospectIdx:    index("messages_prospect_idx").on(t.tenantId, t.prospectId),
}));

export const callAttempts = pgTable("call_attempts", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  prospectId:     uuid("prospect_id").notNull().references(() => prospectsRaw.id),
  direction:      text("direction").notNull().default("inbound"), // "inbound" | "outbound"
  status:         text("status").notNull().default("queued"),
  attemptCount:   integer("attempt_count").notNull().default(0),
  maxAttempts:    integer("max_attempts").notNull().default(4),
  nextAttemptAt:  timestamp("next_attempt_at"),
  lastAttemptAt:  timestamp("last_attempt_at"),
  source:         text("source"), // "lead_manual" | "campaign" | "callback"
  complianceBlockedReason: text("compliance_blocked_reason"),
  bookingStatus:  text("booking_status").notNull().default("none"), // "none" | "proposed" | "confirmed" | "declined"
  bookingRef:     text("booking_ref"), // appointments.id when booked
  dndAt:          timestamp("dnd_at"),
  scheduledBy:    uuid("scheduled_by").references(() => users.id),
  twilioCallSid:  text("twilio_call_sid"),
  duration:       integer("duration"),               // seconds
  outcome:        text("outcome"),
  recordingUrl:   text("recording_url"),             // object storage path
  transcriptUrl:  text("transcript_url"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

// ─── Consent + DNC ────────────────────────────────────────────────────────────

export const consentEvents = pgTable("consent_events", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull().references(() => tenants.id),
  prospectId:     uuid("prospect_id").notNull().references(() => prospectsRaw.id),
  eventType:      text("event_type").notNull(), // "given" | "revoked" | "inferred"
  channel:        text("channel").notNull(),
  evidence:       text("evidence"),            // e.g. form submission ID
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

export const doNotContact = pgTable("do_not_contact", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull().references(() => tenants.id),
  phone:          text("phone"),
  email:          text("email"),
  domain:         text("domain"),
  reason:         text("reason").notNull(), // "unsubscribe" | "bounce" | "manual" | "legal"
  addedBy:        uuid("added_by").references(() => users.id),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  emailIdx:       index("dnc_email_idx").on(t.tenantId, t.email),
  phoneIdx:       index("dnc_phone_idx").on(t.tenantId, t.phone),
}));

// ─── Appointments ─────────────────────────────────────────────────────────────

export const appointments = pgTable("appointments", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull().references(() => tenants.id),
  prospectId:     uuid("prospect_id").notNull().references(() => prospectsRaw.id),
  calBookingUid:  text("cal_booking_uid"),
  startAt:        timestamp("start_at").notNull(),
  endAt:          timestamp("end_at").notNull(),
  status:         text("status").notNull().default("proposed"),
  notes:          text("notes"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

// ─── Client assistant sessions ────────────────────────────────────────────────

export const assistantSessions = pgTable("assistant_sessions", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull().references(() => tenants.id),
  prospectId:           uuid("prospect_id").references(() => prospectsRaw.id),
  sessionType:          text("session_type").notNull(), // "website_widget" | "missed_call_sms"
  turnCount:            integer("turn_count").notNull().default(0),
  compactionCount:      integer("compaction_count").notNull().default(0),
  tokenCountBeforeComp: integer("token_count_before_comp"),
  tokenCountAfterComp:  integer("token_count_after_comp"),
  escalated:            boolean("escalated").notNull().default(false),
  conversationHistory:  jsonb("conversation_history").notNull().default([]),  // [{role, content}] for voice turns
  endedAt:              timestamp("ended_at"),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
});

// ─── Prompts ──────────────────────────────────────────────────────────────────

export const promptVersions = pgTable("prompt_versions", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull().references(() => tenants.id),
  promptPackId:   text("prompt_pack_id").notNull(),  // e.g. "medspa_missed_call_v1"
  version:        integer("version").notNull(),
  content:        text("content").notNull(),
  status:         text("status").notNull().default("draft"), // "draft" | "approved" | "deprecated"
  approvedBy:     uuid("approved_by").references(() => users.id),
  approvedAt:     timestamp("approved_at"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

// ─── Usage / billing / audit ──────────────────────────────────────────────────

export const usageEvents = pgTable("usage_events", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull().references(() => tenants.id),
  agentName:      text("agent_name").notNull(),
  model:          text("model").notNull(),
  modelTier:      text("model_tier").notNull(),
  inputTokens:    integer("input_tokens").notNull(),
  outputTokens:   integer("output_tokens").notNull(),
  cached:         boolean("cached").notNull().default(false),
  runId:          uuid("run_id"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantDateIdx:  index("usage_tenant_date_idx").on(t.tenantId, t.createdAt),
}));

export const billingEvents = pgTable("billing_events", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull().references(() => tenants.id),
  stripeEventId:  text("stripe_event_id").notNull().unique(),
  eventType:      text("event_type").notNull(),
  amount:         integer("amount"),                 // cents
  metadata:       jsonb("metadata").default({}),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

export const tenantSubscriptions = pgTable("tenant_subscriptions", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  stripeCustomerId:     text("stripe_customer_id").notNull().unique(),
  stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
  stripePriceId:        text("stripe_price_id").notNull(),
  status:               text("status").notNull(), // trialing | active | past_due | canceled | unpaid
  productAccess:        jsonb("product_access").notNull().default({ lead: false, assist: false }),
  currentPeriodStart:   timestamp("current_period_start"),
  currentPeriodEnd:     timestamp("current_period_end"),
  cancelAtPeriodEnd:    boolean("cancel_at_period_end").notNull().default(false),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
  updatedAt:            timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx:            uniqueIndex("tenant_subscriptions_tenant_idx").on(t.tenantId),
  statusIdx:            index("tenant_subscriptions_status_idx").on(t.status),
}));

export const auditLogs = pgTable("audit_logs", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull().references(() => tenants.id),
  userId:         uuid("user_id").references(() => users.id),
  action:         text("action").notNull(),
  resourceType:   text("resource_type"),
  resourceId:     uuid("resource_id"),
  before:         jsonb("before"),
  after:          jsonb("after"),
  ipAddress:      text("ip_address"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx:      index("audit_tenant_idx").on(t.tenantId, t.createdAt),
}));

export const webhookEvents = pgTable("webhook_events", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").references(() => tenants.id),
  source:         text("source").notNull(),           // "stripe" | "clerk" | "cal" | "twilio"
  eventType:      text("event_type").notNull(),
  payload:        jsonb("payload").notNull(),
  processed:      boolean("processed").notNull().default(false),
  processedAt:    timestamp("processed_at"),
  error:          text("error"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

export const deadLetterQueue = pgTable("dead_letter_queue", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull().references(() => tenants.id),
  workflowName:   text("workflow_name").notNull(),
  payload:        jsonb("payload").notNull(),
  errorType:      text("error_type").notNull(),
  attemptCount:   integer("attempt_count").notNull().default(0),
  lastError:      text("last_error"),
  resolvedAt:     timestamp("resolved_at"),
  resolvedBy:     uuid("resolved_by").references(() => users.id),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});
