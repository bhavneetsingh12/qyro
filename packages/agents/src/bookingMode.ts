import { type ProviderKind } from "./calendars/types";
export type BookingMode = "direct_booking" | "booking_link_sms" | "callback_only";

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
