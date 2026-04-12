import { db, decryptSecret, tenantIntegrationSecrets, tenants } from "@qyro/db";
import { eq } from "drizzle-orm";
import { CalComAdapter } from "./calendars/calCom";
import { GoogleCalendarAdapter } from "./calendars/googleCalendar";
import { type CalendarAdapter, type ProviderKind } from "./calendars/types";

export type BookingMode = "direct_booking" | "booking_link_sms" | "callback_only";

type TenantRow = typeof tenants.$inferSelect;

export type TenantBookingConfig = {
  tenant: TenantRow;
  provider: ProviderKind;
  bookingMode: BookingMode;
  bookingUrl: string;
  eventTypeId: string;
  calendarApiKey: string;
  timezone: string | null;
  supportsDirectBooking: boolean;
  supportsAvailabilityLookup: boolean;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readSecretValue(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const text = cleanString(candidate);
    if (!text) continue;
    return decryptSecret(text) ?? "";
  }
  return "";
}

export function normalizeCalendarProvider(raw: unknown): ProviderKind {
  const value = cleanString(raw).toLowerCase().replace(/[.\s-]/g, "_");

  if (value === "calcom" || value === "cal_com") return "cal_com";
  if (value === "google" || value === "google_calendar") return "google_calendar";
  if (value === "calendly") return "calendly";
  if (value === "square" || value === "square_appointments") return "square_appointments";
  if (value === "acuity") return "acuity";
  return "callback_only";
}

export function normalizeBookingMode(raw: unknown, provider: ProviderKind): BookingMode {
  const value = cleanString(raw).toLowerCase();
  if (value === "direct_booking" || value === "booking_link_sms" || value === "callback_only") {
    return value;
  }

  if (provider === "calendly" || provider === "square_appointments" || provider === "acuity") {
    return "booking_link_sms";
  }

  if (provider === "callback_only") {
    return "callback_only";
  }

  return "direct_booking";
}

export async function resolveTenantBookingConfig(params: {
  tenantId?: string;
  tenant?: TenantRow;
}): Promise<TenantBookingConfig> {
  const tenant = params.tenant ?? await db.query.tenants.findFirst({
    where: eq(tenants.id, String(params.tenantId ?? "")),
  });

  if (!tenant) {
    throw new Error(`Tenant not found: ${String(params.tenantId ?? "")}`);
  }

  const meta = (tenant.metadata as Record<string, unknown> | null) ?? {};
  const provider = normalizeCalendarProvider(meta.calendarProvider ?? meta.calendar_provider);
  const bookingMode = normalizeBookingMode(meta.bookingMode ?? meta.booking_mode, provider);
  const bookingUrl = cleanString(meta.calendarBookingUrl ?? meta.calendar_booking_url ?? meta.bookingLink);
  const eventTypeId = cleanString(meta.calendarEventTypeId ?? meta.calendar_event_type_id);
  const integrationSecrets = await db.query.tenantIntegrationSecrets.findFirst({
    where: eq(tenantIntegrationSecrets.tenantId, tenant.id),
  });
  const calendarApiKey = readSecretValue(
    integrationSecrets?.calendarApiKey,
    meta.calendarApiKey as string | undefined,
    meta.calendar_api_key as string | undefined,
  );
  const timezone = cleanString(meta.timezone) || null;

  const supportsDirectBooking = (
    provider === "cal_com" && Boolean(calendarApiKey && eventTypeId)
  ) || (
    provider === "google_calendar" && Boolean(eventTypeId && process.env.GOOGLE_CALENDAR_ACCESS_TOKEN)
  );

  const supportsAvailabilityLookup = provider === "cal_com" && Boolean(calendarApiKey && eventTypeId);

  return {
    tenant,
    provider,
    bookingMode,
    bookingUrl,
    eventTypeId,
    calendarApiKey,
    timezone,
    supportsDirectBooking,
    supportsAvailabilityLookup,
  };
}

export function getCalendarAdapterForConfig(config: TenantBookingConfig): CalendarAdapter | null {
  if (config.provider === "cal_com" && config.calendarApiKey && config.eventTypeId) {
    return new CalComAdapter({
      apiKey: config.calendarApiKey,
      defaultEventTypeId: config.eventTypeId,
    });
  }

  if (config.provider === "google_calendar" && config.eventTypeId) {
    return new GoogleCalendarAdapter({
      defaultCalendarId: config.eventTypeId,
    });
  }

  return null;
}
