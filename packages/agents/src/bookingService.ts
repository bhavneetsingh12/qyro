// Shared booking execution service.
//
// All channels (chat, voice SWAIG, voice turn, manual) call executeBooking() to:
//   1. Resolve tenant booking config
//   2. Check blackout blocks (AI channels only)
//   3. Execute based on booking mode: direct_booking → booking_link_sms → callback_only
//   4. Persist an appointment record
//   5. Return a channel-appropriate result
//
// Slot discovery for direct_booking is the caller's responsibility.
// Pass startAt/endAt for the chosen (or requested) time window.

import { db } from "@qyro/db";
import { appointments, blackoutBlocks } from "@qyro/db";
import { and, eq, gte, lte } from "drizzle-orm";
import { getCalendarAdapterForConfig, resolveTenantBookingConfig } from "./assistBooking";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BookingChannel = "chat" | "voice_swaig" | "voice_turn" | "manual";

export type BookingRequest = {
  tenantId: string;
  /** Must be a valid prospectsRaw.id — callers are responsible for finding/creating the prospect. */
  prospectId: string;
  callerName: string;
  callerPhone: string;
  callerEmail?: string;
  service?: string;
  startAt: Date;
  endAt: Date;
  channel: BookingChannel;
  notes?: string;
  /** userId when channel === "manual". Stored on the appointment for audit trail. */
  createdBy?: string;
};

export type BookingResult = {
  status: "booked" | "booking_link_sent" | "callback_requested" | "blocked_blackout" | "error";
  appointmentId?: string;
  calBookingUid?: string;
  /** AI/voice reply text. Empty string for manual channel. */
  aiResponse: string;
  escalate: boolean;
  escalationReason?: string;
};

// ─── SignalWire SMS ───────────────────────────────────────────────────────────
// Inline here so the booking service has no dependency on apps/api utilities.

async function sendSignalWireSms(params: {
  from: string;
  to: string;
  body: string;
}): Promise<string | null> {
  const projectId = process.env.SIGNALWIRE_PROJECT_ID;
  const token = process.env.SIGNALWIRE_API_TOKEN;
  const spaceUrl = process.env.SIGNALWIRE_SPACE_URL;

  if (!projectId || !token || !spaceUrl) {
    console.warn("[bookingService/sms] SignalWire env vars not set — SMS skipped");
    return null;
  }

  try {
    const url = `https://${spaceUrl}/api/laml/2010-04-01/Accounts/${projectId}/Messages.json`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${projectId}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: params.from,
        To: params.to,
        Body: params.body,
      }).toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn(`[bookingService/sms] SignalWire ${response.status}: ${text}`);
      return null;
    }

    const data = (await response.json()) as { sid?: string };
    return data.sid ?? null;
  } catch (err) {
    console.warn("[bookingService/sms] fetch error:", err);
    return null;
  }
}

// ─── Blackout check ───────────────────────────────────────────────────────────

async function isBlackedOut(tenantId: string, startAt: Date, endAt: Date): Promise<boolean> {
  const conflicts = await db
    .select({ id: blackoutBlocks.id })
    .from(blackoutBlocks)
    .where(
      and(
        eq(blackoutBlocks.tenantId, tenantId),
        // Overlap: block starts before our end AND block ends after our start
        lte(blackoutBlocks.startAt, endAt),
        gte(blackoutBlocks.endAt, startAt),
      ),
    )
    .limit(1);

  return conflicts.length > 0;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// ─── Blackout writeback helpers ───────────────────────────────────────────────
// Called from the API routes after creating/deleting a blackout_block row.
// Returns the provider event ID on success, null if provider doesn't support it
// or if the call fails (callers should store null and continue).

export async function attemptBlackoutWriteback(params: {
  tenantId: string;
  label: string;
  startAt: Date;
  endAt: Date;
  notes?: string;
}): Promise<string | null> {
  try {
    const config = await resolveTenantBookingConfig({ tenantId: params.tenantId });
    const adapter = getCalendarAdapterForConfig(config);
    if (!adapter?.createBlock) return null;

    const block = await adapter.createBlock({
      calendarId: config.eventTypeId || undefined,
      startAt: params.startAt.toISOString(),
      endAt: params.endAt.toISOString(),
      label: params.label,
      notes: params.notes,
      timeZone:
        config.timezone ??
        process.env.DEFAULT_TIMEZONE ??
        "America/Los_Angeles",
    });

    return block.id;
  } catch (err) {
    console.warn("[bookingService] blackout writeback failed:", err);
    return null;
  }
}

export async function attemptBlackoutCancelWriteback(params: {
  tenantId: string;
  providerBlockId: string;
}): Promise<void> {
  try {
    const config = await resolveTenantBookingConfig({ tenantId: params.tenantId });
    const adapter = getCalendarAdapterForConfig(config);
    if (!adapter?.cancelBlock) return;

    await adapter.cancelBlock(params.providerBlockId);
  } catch (err) {
    console.warn("[bookingService] blackout cancel writeback failed:", err);
  }
}

// ─── Main execution ───────────────────────────────────────────────────────────

export async function executeBooking(request: BookingRequest): Promise<BookingResult> {
  const {
    tenantId,
    prospectId,
    callerName,
    callerPhone,
    callerEmail,
    service,
    startAt,
    endAt,
    channel,
    notes,
    createdBy,
  } = request;

  try {
    const config = await resolveTenantBookingConfig({ tenantId });
    const fromPhone = config.tenant.voiceNumber ?? null;
    const escalationPhone = config.tenant.escalationContactPhone ?? null;

    const dateStr = fmtDate(startAt);
    const timeStr = fmtTime(startAt);
    const serviceLabel = service || "appointment";

    // ── Blackout check (AI channels only — manual bookings can override) ──────

    if (channel !== "manual") {
      const blacked = await isBlackedOut(tenantId, startAt, endAt);
      if (blacked) {
        return {
          status: "blocked_blackout",
          aiResponse:
            "I'm sorry, that time is not available. A team member will follow up to find a time that works.",
          escalate: true,
          escalationReason: "blackout_block",
        };
      }
    }

    // ── Manual booking (staff-initiated) ─────────────────────────────────────
    // bookingMode controls AI behavior only. Manual bookings always attempt a
    // provider write if the integration is capable, then save locally.
    // No SMS is sent regardless of mode.

    if (channel === "manual") {
      let calBookingUid: string | null = null;
      if (config.supportsDirectBooking) {
        const adapter = getCalendarAdapterForConfig(config);
        if (adapter) {
          try {
            const email =
              callerEmail ??
              (callerPhone
                ? `${callerPhone.replace(/\D/g, "")}@placeholder.qyro.us`
                : "staff@qyro.local");

            const booking = await adapter.createBooking({
              calendarId: config.eventTypeId || undefined,
              startAt: startAt.toISOString(),
              endAt: endAt.toISOString(),
              name: callerName,
              email,
              notes: [
                notes,
                service ? `Service: ${service}` : "",
                "Manual booking by staff",
              ]
                .filter(Boolean)
                .join(". "),
              timeZone:
                config.timezone ??
                process.env.DEFAULT_TIMEZONE ??
                "America/Los_Angeles",
            });
            calBookingUid = booking.id;
          } catch (err) {
            console.warn(
              "[bookingService] manual provider write failed — saving locally only:",
              err,
            );
          }
        }
      }

      const [appt] = await db
        .insert(appointments)
        .values({
          tenantId,
          prospectId,
          calBookingUid,
          startAt,
          endAt,
          status: "confirmed",
          source: "manual",
          createdBy: createdBy ?? null,
          notes: [
            calBookingUid
              ? `Manual booking — synced to ${config.provider}.`
              : `Manual booking — saved locally (provider write skipped or failed).`,
            service ? `Service: ${service}.` : "",
            notes ?? "",
          ]
            .filter(Boolean)
            .join(" "),
        })
        .returning({ id: appointments.id });

      return {
        status: "booked",
        appointmentId: appt?.id,
        calBookingUid: calBookingUid ?? undefined,
        aiResponse: "",
        escalate: false,
      };
    }

    // ── Direct booking (AI channels) ─────────────────────────────────────────

    if (config.bookingMode === "direct_booking" && config.supportsDirectBooking) {
      const adapter = getCalendarAdapterForConfig(config);
      if (adapter) {
        try {
          const email =
            callerEmail ?? `${callerPhone.replace(/\D/g, "")}@placeholder.qyro.us`;

          const booking = await adapter.createBooking({
            calendarId: config.eventTypeId || undefined,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
            name: callerName,
            email,
            notes: [
              notes,
              service ? `Service: ${service}` : "",
              `Booked via ${channel} (${config.provider})`,
            ]
              .filter(Boolean)
              .join(". "),
            timeZone:
              config.timezone ??
              process.env.DEFAULT_TIMEZONE ??
              "America/Los_Angeles",
          });

          const [appt] = await db
            .insert(appointments)
            .values({
              tenantId,
              prospectId,
              calBookingUid: booking.id,
              startAt,
              endAt,
              status: "confirmed",
              source: channel,
              createdBy: createdBy ?? null,
              notes: [
                `Booked via ${channel} (${config.provider}, direct_booking).`,
                service ? `Service: ${service}.` : "",
                notes ?? "",
              ]
                .filter(Boolean)
                .join(" "),
            })
            .returning({ id: appointments.id });

          return {
            status: "booked",
            appointmentId: appt?.id,
            calBookingUid: booking.id,
            aiResponse: `Your ${serviceLabel} is confirmed for ${dateStr} at ${timeStr}. You'll receive a confirmation shortly.`,
            escalate: false,
          };
        } catch (err) {
          console.warn(`[bookingService] direct booking failed for tenant ${tenantId}:`, err);
          // Fall through to callback_only
        }
      }
    }

    // ── Booking link SMS ──────────────────────────────────────────────────────

    if (config.bookingMode === "booking_link_sms" && config.bookingUrl) {
      if (channel !== "chat" && fromPhone && callerPhone) {
        await sendSignalWireSms({
          from: fromPhone,
          to: callerPhone,
          body: `Hi ${callerName}! Book your ${serviceLabel} here: ${config.bookingUrl}\nReply STOP to opt out.`,
        }).catch((err) =>
          console.warn("[bookingService] booking-link SMS failed:", err),
        );
      }

      const [appt] = await db
        .insert(appointments)
        .values({
          tenantId,
          prospectId,
          startAt,
          endAt,
          status: "proposed",
          source: channel,
          createdBy: createdBy ?? null,
          notes: [
            `Booking link sent via ${channel}.`,
            service ? `Service: ${service}.` : "",
            notes ?? "",
          ]
            .filter(Boolean)
            .join(" "),
        })
        .returning({ id: appointments.id });

      return {
        status: "booking_link_sent",
        appointmentId: appt?.id,
        aiResponse:
          channel === "chat"
            ? `You can schedule your ${serviceLabel} here: ${config.bookingUrl}`
            : `I've sent you a text with a link to schedule your ${serviceLabel}. Is there anything else I can help with?`,
        escalate: false,
      };
    }

    // ── Callback only (AI channels, default fallback) ─────────────────────────

    if (fromPhone && escalationPhone) {
      await sendSignalWireSms({
        from: fromPhone,
        to: escalationPhone,
        body:
          `New appointment request: ${callerName} wants ${serviceLabel} on ${dateStr} at ${timeStr}. ` +
          `Call them back at ${callerPhone} to confirm.`,
      }).catch((err) =>
        console.warn("[bookingService] business callback SMS failed:", err),
      );
    }

    if (fromPhone && callerPhone) {
      await sendSignalWireSms({
        from: fromPhone,
        to: callerPhone,
        body:
          `Hi ${callerName}! We've received your appointment request for ${serviceLabel} on ${dateStr}. ` +
          `We'll call you back to confirm. Reply STOP to opt out.`,
      }).catch((err) =>
        console.warn("[bookingService] caller callback SMS failed:", err),
      );
    }

    const [appt] = await db
      .insert(appointments)
      .values({
        tenantId,
        prospectId,
        startAt,
        endAt,
        status: "pending_confirmation",
        source: channel,
        createdBy: createdBy ?? null,
        notes: [
          `Callback requested via ${channel} (mode: ${config.bookingMode}, provider: ${config.provider}).`,
          service ? `Service: ${service}.` : "",
          notes ?? "",
        ]
          .filter(Boolean)
          .join(" "),
      })
      .returning({ id: appointments.id });

    const escalationReason =
      config.bookingMode === "callback_only"
        ? "booking_callback_required"
        : "booking_fallback";

    return {
      status: "callback_requested",
      appointmentId: appt?.id,
      aiResponse:
        channel === "chat"
          ? "I've captured your appointment request. A team member will follow up to confirm the best time."
          : "I've sent your appointment request. Someone from our team will call you back to confirm. Is there anything else I can help with?",
      escalate: true,
      escalationReason,
    };
  } catch (err) {
    console.error("[bookingService] unexpected error:", err);
    return {
      status: "error",
      aiResponse:
        "I ran into an issue while scheduling. A team member will follow up to complete your booking.",
      escalate: true,
      escalationReason: "booking_error",
    };
  }
}
