import {
  type Booking,
  type CalendarAdapter,
  type CreateBookingParams,
  type GetAvailableSlotsParams,
  type Provider,
  type Slot,
} from "./types";

const GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

type GoogleEvent = {
  id: string;
  status: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: Array<{ email?: string; displayName?: string }>;
};

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Google Calendar adapter`);
  return value;
}

function mapEventToSlot(event: GoogleEvent, providerId?: string, calendarId?: string): Slot | null {
  const startAt = event.start?.dateTime;
  const endAt = event.end?.dateTime;
  if (!startAt || !endAt) return null;

  return {
    startAt,
    endAt,
    providerId,
    calendarId,
    raw: event,
  };
}

function mapEventToBooking(event: GoogleEvent, providerId?: string): Booking {
  return {
    id: event.id,
    providerBookingId: event.id,
    startAt: event.start?.dateTime ?? "",
    endAt: event.end?.dateTime ?? "",
    providerId,
    status: event.status === "cancelled" ? "cancelled" : "confirmed",
    raw: event,
  };
}

async function googleFetch(path: string, init?: RequestInit): Promise<Response> {
  const accessToken = getRequiredEnv("GOOGLE_CALENDAR_ACCESS_TOKEN");
  return fetch(`${GOOGLE_CALENDAR_API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
}

export class GoogleCalendarAdapter implements CalendarAdapter {
  private readonly defaultCalendarId: string;
  private readonly defaultProviderId: string;

  constructor(params?: { defaultCalendarId?: string; defaultProviderId?: string }) {
    this.defaultCalendarId =
      params?.defaultCalendarId ??
      process.env.GOOGLE_CALENDAR_ID ??
      "primary";
    this.defaultProviderId = params?.defaultProviderId ?? "google-primary";
  }

  async getAvailableSlots(params: GetAvailableSlotsParams): Promise<Slot[]> {
    const calendarId = params.calendarId ?? this.defaultCalendarId;
    const query = new URLSearchParams({
      timeMin: params.startAt,
      timeMax: params.endAt,
      singleEvents: "true",
      orderBy: "startTime",
    });

    const res = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`);
    if (!res.ok) {
      throw new Error(`Google Calendar events ${res.status}`);
    }

    const data = (await res.json()) as { items?: GoogleEvent[] };
    const busySlots = (data.items ?? [])
      .map((event) => mapEventToSlot(event, params.providerId ?? this.defaultProviderId, calendarId))
      .filter((slot): slot is Slot => slot !== null);

    return busySlots;
  }

  async getProviders(): Promise<Provider[]> {
    return [
      {
        id: this.defaultProviderId,
        name: "Google Calendar",
        calendarId: this.defaultCalendarId,
        active: true,
      },
    ];
  }

  async createBooking(params: CreateBookingParams): Promise<Booking> {
    const calendarId = params.calendarId ?? this.defaultCalendarId;
    const eventBody = {
      summary: `QYRO Assist booking - ${params.name}`,
      description: params.notes ?? "Booked via QYRO Assist",
      start: {
        dateTime: params.startAt,
        timeZone: params.timeZone ?? process.env.DEFAULT_TIMEZONE ?? "America/Los_Angeles",
      },
      end: {
        dateTime: params.endAt,
        timeZone: params.timeZone ?? process.env.DEFAULT_TIMEZONE ?? "America/Los_Angeles",
      },
      attendees: [{ email: params.email, displayName: params.name }],
    };

    const res = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      body: JSON.stringify(eventBody),
    });

    if (!res.ok) {
      throw new Error(`Google Calendar create booking ${res.status}`);
    }

    const created = (await res.json()) as GoogleEvent;
    return mapEventToBooking(created, params.providerId ?? this.defaultProviderId);
  }

  async cancelBooking(bookingId: string): Promise<void> {
    const res = await googleFetch(`/calendars/${encodeURIComponent(this.defaultCalendarId)}/events/${encodeURIComponent(bookingId)}`, {
      method: "DELETE",
    });

    if (!res.ok && res.status !== 404) {
      throw new Error(`Google Calendar cancel booking ${res.status}`);
    }
  }

  async getBooking(bookingId: string): Promise<Booking> {
    const res = await googleFetch(`/calendars/${encodeURIComponent(this.defaultCalendarId)}/events/${encodeURIComponent(bookingId)}`);
    if (!res.ok) {
      throw new Error(`Google Calendar get booking ${res.status}`);
    }

    const event = (await res.json()) as GoogleEvent;
    return mapEventToBooking(event, this.defaultProviderId);
  }
}
