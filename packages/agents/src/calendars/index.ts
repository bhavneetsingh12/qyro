import { CalComAdapter } from "./calCom";
import { GoogleCalendarAdapter } from "./googleCalendar";
import { type CalendarAdapter, type ProviderKind } from "./types";

type TenantWithCalendarProvider = {
  metadata?: {
    calendar_provider?: string;
  } | null;
};

function normalizeProvider(value?: string | null): ProviderKind {
  const normalized = (value ?? "").trim().toLowerCase();

  if (normalized === "google" || normalized === "google_calendar") {
    return "google_calendar";
  }

  if (normalized === "cal.com" || normalized === "calcom" || normalized === "cal_com") {
    return "cal_com";
  }

  const envProvider = (process.env.DEFAULT_CALENDAR_PROVIDER ?? "cal_com").trim().toLowerCase();
  if (envProvider === "google" || envProvider === "google_calendar") {
    return "google_calendar";
  }

  return "cal_com";
}

export function getCalendarAdapter(tenant: TenantWithCalendarProvider): CalendarAdapter {
  const provider = normalizeProvider(tenant.metadata?.calendar_provider);

  if (provider === "google_calendar") {
    return new GoogleCalendarAdapter();
  }

  return new CalComAdapter();
}

export * from "./types";
export * from "./googleCalendar";
export * from "./calCom";
