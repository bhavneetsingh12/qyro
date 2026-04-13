// QYRO Database Schema — Drizzle ORM
// RULE: every table has tenant_id. Never query without it.
// Run: pnpm db:generate && pnpm db:migrate

import {
  pgTable, uuid, text, integer, boolean, jsonb,
  timestamp, pgEnum, index, uniqueIndex, date
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
  id:            uuid("id").primaryKey().defaultRandom(),
  name:          text("name").notNull(),
  slug:          text("slug").notNull().unique(),
  plan:          text("plan").notNull().default("starter"),
  voiceNumber:             text("voice_number"),
  autoSendMissedCall:      boolean("auto_send_missed_call").notNull().default(false),
  escalationContactPhone:  text("escalation_contact_phone"),
  escalationContactEmail:  text("escalation_contact_email"),
  active:                  boolean("active").notNull().default(true),
  metadata:      jsonb("metadata").default({}),
  dataFrozenAt:  timestamp("data_frozen_at"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  voiceNumberIdx: index("tenants_voice_number_idx").on(t.voiceNumber),
}));

export const tenantIntegrationSecrets = pgTable("tenant_integration_secrets", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  calendarApiKey: text("calendar_api_key"),
  apolloApiKey:   text("apollo_api_key"),
  hunterApiKey:   text("hunter_api_key"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx: uniqueIndex("tenant_integration_secrets_tenant_idx").on(t.tenantId),
}));

export const users = pgTable("users", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  clerkId:        text("clerk_id").notNull().unique(),
  email:          text("email").notNull(),
  name:           text("name"),
  role:           text("role").notNull().default("sales_rep"),
  active:         boolean("active").notNull().default(true),
  tosAcceptedAt:  timestamp("tos_accepted_at"),
  tosAcceptedIp:  text("tos_accepted_ip"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
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
  sourceType:     text("source_type").notNull().default("business"), // "business" | "individual"
  sourceId:       text("source_id"),                  // external ID from source
  businessName:   text("business_name").notNull(),
  domain:         text("domain"),
  phone:          text("phone"),
  email:          text("email"),
  address:        text("address"),
  prospectTimezone: text("prospect_timezone"),
  niche:          text("niche"),
  consentState:   text("consent_state").notNull().default("unknown"),
  researchSkipped: boolean("research_skipped").notNull().default(false),
  researchSkipReason: text("research_skip_reason"),
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
  campaignId:     uuid("campaign_id"),
  complianceSellerName: text("compliance_seller_name"),
  complianceAutomated: boolean("compliance_automated").notNull().default(true),
  complianceBlockedReason: text("compliance_blocked_reason"),
  bookingStatus:  text("booking_status").notNull().default("none"), // "none" | "proposed" | "confirmed" | "declined"
  bookingRef:     text("booking_ref"), // appointments.id when booked
  dndAt:          timestamp("dnd_at"),
  scheduledBy:    uuid("scheduled_by").references(() => users.id),
  callSid:        text("call_sid"),
  duration:       integer("duration"),               // seconds
  durationSeconds: integer("duration_seconds"),      // normalized duration for recordings/transcripts
  outcome:        text("outcome"),
  recordingUrl:   text("recording_url"),             // object storage path
  transcriptText: text("transcript_text"),
  transcriptJson: jsonb("transcript_json").default([]),
  transcriptUrl:  text("transcript_url"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

export const dailySummaries = pgTable("daily_summaries", {
  id:                     uuid("id").primaryKey().defaultRandom(),
  tenantId:               uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  date:                   date("date").notNull(),
  newProspectsCount:      integer("new_prospects_count").notNull().default(0),
  pendingApprovalCount:   integer("pending_approval_count").notNull().default(0),
  approvedCount:          integer("approved_count").notNull().default(0),
  blockedCount:           integer("blocked_count").notNull().default(0),
  callsHandledCount:      integer("calls_handled_count").notNull().default(0),
  appointmentsBookedCount: integer("appointments_booked_count").notNull().default(0),
  escalationsCount:       integer("escalations_count").notNull().default(0),
  questionsCount:         integer("questions_count").notNull().default(0),
  avgUrgencyScore:        integer("avg_urgency_score"),
  createdAt:              timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantDateIdx: uniqueIndex("daily_summaries_tenant_date_idx").on(t.tenantId, t.date),
  tenantIdx: index("daily_summaries_tenant_idx").on(t.tenantId, t.date),
}));

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

export const consentRecords = pgTable("consent_records", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  prospectId:        uuid("prospect_id").references(() => prospectsRaw.id, { onDelete: "set null" }),
  phoneE164:         text("phone_e164").notNull(),
  sellerName:        text("seller_name").notNull(),
  consentChannel:    text("consent_channel").notNull(), // voice | sms | both
  consentType:       text("consent_type").notNull(), // written | express | inquiry_only | unknown
  disclosureText:    text("disclosure_text"),
  disclosureVersion: text("disclosure_version"),
  formUrl:           text("form_url"),
  ipAddress:         text("ip_address"),
  userAgent:         text("user_agent"),
  capturedAt:        timestamp("captured_at").notNull(),
  expiresAt:         timestamp("expires_at"),
  revokedAt:         timestamp("revoked_at"),
  revokedReason:     text("revoked_reason"),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantPhoneIdx:    index("consent_records_tenant_phone_idx").on(t.tenantId, t.phoneE164),
  tenantCapturedIdx: index("consent_records_tenant_captured_idx").on(t.tenantId, t.capturedAt),
}));

export const suppressions = pgTable("suppressions", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  phoneE164:       text("phone_e164"),
  email:           text("email"),
  domain:          text("domain"),
  suppressionType: text("suppression_type").notNull(), // internal_dnc | stop_reply | verbal_optout | manual_block
  scope:           text("scope").notNull().default("global"), // global | seller_specific | campaign_specific
  sellerName:      text("seller_name"),
  campaignId:      uuid("campaign_id"),
  reason:          text("reason"),
  effectiveAt:     timestamp("effective_at").notNull().defaultNow(),
  revokedAt:       timestamp("revoked_at"),
  sourceEventId:   uuid("source_event_id"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantPhoneIdx:  index("suppressions_tenant_phone_idx").on(t.tenantId, t.phoneE164),
  tenantEmailIdx:  index("suppressions_tenant_email_idx").on(t.tenantId, t.email),
  tenantDomainIdx: index("suppressions_tenant_domain_idx").on(t.tenantId, t.domain),
}));

export const complianceDecisions = pgTable("compliance_decisions", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  prospectId:      uuid("prospect_id").references(() => prospectsRaw.id, { onDelete: "set null" }),
  campaignId:      uuid("campaign_id"),
  channel:         text("channel").notNull(),
  automated:       boolean("automated").notNull().default(true),
  decision:        text("decision").notNull(), // ALLOW | BLOCK | MANUAL_REVIEW
  ruleCode:        text("rule_code").notNull(),
  explanation:     text("explanation").notNull(),
  consentRecordId: uuid("consent_record_id").references(() => consentRecords.id, { onDelete: "set null" }),
  suppressionId:   uuid("suppression_id").references(() => suppressions.id, { onDelete: "set null" }),
  evaluatedAt:     timestamp("evaluated_at").notNull().defaultNow(),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantEvalIdx:   index("compliance_decisions_tenant_eval_idx").on(t.tenantId, t.evaluatedAt),
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
  // "chat" | "voice_swaig" | "voice_turn" | "manual"
  source:         text("source"),
  notes:          text("notes"),
  createdBy:      uuid("created_by").references(() => users.id),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

// ─── Blackout blocks ──────────────────────────────────────────────────────────
// Staff-managed periods during which AI booking is blocked.
// Manual bookings (channel === "manual") skip this check.

export const blackoutBlocks = pgTable("blackout_blocks", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  label:           text("label").notNull(),
  startAt:         timestamp("start_at").notNull(),
  endAt:           timestamp("end_at").notNull(),
  notes:           text("notes"),
  providerBlockId: text("provider_block_id"),   // external calendar event ID for writeback
  createdBy:       uuid("created_by").references(() => users.id),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx:  index("blackout_blocks_tenant_idx").on(t.tenantId),
  rangeIdx:   index("blackout_blocks_range_idx").on(t.tenantId, t.startAt, t.endAt),
}));

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
  escalationReason:     text("escalation_reason"),
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
  id:                    uuid("id").primaryKey().defaultRandom(),
  tenantId:              uuid("tenant_id").notNull().references(() => tenants.id),
  userId:                uuid("user_id").references(() => users.id),
  action:                text("action").notNull(),
  resourceType:          text("resource_type"),
  resourceId:            uuid("resource_id"),
  before:                jsonb("before"),
  after:                 jsonb("after"),
  ipAddress:             text("ip_address"),
  endpoint:              text("endpoint"),
  userAgent:             text("user_agent"),
  requestCount:          integer("request_count"),
  responseRecordCount:   integer("response_record_count"),
  createdAt:             timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx:      index("audit_tenant_idx").on(t.tenantId, t.createdAt),
}));

export const scrapingAlerts = pgTable("scraping_alerts", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  patternDetected:  text("pattern_detected").notNull(),
  requestCount:     integer("request_count").notNull().default(0),
  metadata:         jsonb("metadata").notNull().default({}),
  resolvedAt:       timestamp("resolved_at"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx:        index("scraping_alerts_tenant_idx").on(t.tenantId, t.createdAt),
}));

export const rateLimitHits = pgTable("rate_limit_hits", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  endpoint:   text("endpoint").notNull(),
  limitType:  text("limit_type").notNull(),
  ipAddress:  text("ip_address"),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx:  index("rate_limit_hits_tenant_idx").on(t.tenantId, t.createdAt),
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
