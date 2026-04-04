import {
  type Booking,
  type CalendarAdapter,
  type CreateBookingParams,
  type GetAvailableSlotsParams,
  type Provider,
  type Slot,
} from "./types";

const CAL_API_BASE = "https://api.cal.com/v1";

type CalSlotsResponse = {
  slots?: Record<string, Array<{ time: string }>>;
};

type CalBookingResponse = {
  id?: number;
  uid?: string;
  startTime?: string;
  endTime?: string;
  status?: string;
};

function getCalApiKey(): string {
  const apiKey = process.env.CAL_API_KEY;
  if (!apiKey) throw new Error("CAL_API_KEY is required for Cal.com adapter");
  return apiKey;
}

function mapCalBookingToBooking(data: CalBookingResponse, providerId?: string): Booking {
  const bookingId = data.uid ?? String(data.id ?? "");
  return {
    id: bookingId,
    providerBookingId: bookingId,
    startAt: data.startTime ?? "",
    endAt: data.endTime ?? "",
    providerId,
    status: data.status === "CANCELLED" ? "cancelled" : "confirmed",
    raw: data,
  };
}

export class CalComAdapter implements CalendarAdapter {
  private readonly apiKey: string;
  private readonly defaultEventTypeId: string;
  private readonly defaultProviderId: string;

  constructor(params?: { apiKey?: string; defaultEventTypeId?: string; defaultProviderId?: string }) {
    this.apiKey = params?.apiKey ?? getCalApiKey();
    this.defaultEventTypeId =
      params?.defaultEventTypeId ??
      process.env.CAL_EVENT_TYPE_ID ??
      "";
    this.defaultProviderId = params?.defaultProviderId ?? "cal.com";
  }

  async getAvailableSlots(params: GetAvailableSlotsParams): Promise<Slot[]> {
    const eventTypeId = params.calendarId ?? this.defaultEventTypeId;
    if (!eventTypeId) {
      throw new Error("calendarId or CAL_EVENT_TYPE_ID is required for Cal.com slots");
    }

    const url = new URL(`${CAL_API_BASE}/slots`);
    url.searchParams.set("apiKey", this.apiKey);
    url.searchParams.set("eventTypeId", eventTypeId);
    url.searchParams.set("startTime", params.startAt);
    url.searchParams.set("endTime", params.endAt);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Cal.com slots ${res.status}`);
    }

    const data = (await res.json()) as CalSlotsResponse;
    const slots: Slot[] = [];

    for (const daySlots of Object.values(data.slots ?? {})) {
      for (const slot of daySlots) {
        const startAt = slot.time;
        const endAt = new Date(new Date(startAt).getTime() + 15 * 60 * 1000).toISOString();
        slots.push({
          startAt,
          endAt,
          providerId: params.providerId ?? this.defaultProviderId,
          calendarId: eventTypeId,
          raw: slot,
        });
      }
    }

    return slots;
  }

  async getProviders(): Promise<Provider[]> {
    return [
      {
        id: this.defaultProviderId,
        name: "Cal.com",
        calendarId: this.defaultEventTypeId || undefined,
        active: true,
      },
    ];
  }

  async createBooking(params: CreateBookingParams): Promise<Booking> {
    const eventTypeId = params.calendarId ?? this.defaultEventTypeId;
    if (!eventTypeId) {
      throw new Error("calendarId or CAL_EVENT_TYPE_ID is required for Cal.com booking");
    }

    const res = await fetch(`${CAL_API_BASE}/bookings?apiKey=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventTypeId,
        start: params.startAt,
        responses: {
          name: params.name,
          email: params.email,
        },
        timeZone: params.timeZone ?? process.env.DEFAULT_TIMEZONE ?? "America/Los_Angeles",
        language: "en",
      }),
    });

    if (!res.ok) {
      throw new Error(`Cal.com booking ${res.status}`);
    }

    const data = (await res.json()) as CalBookingResponse;
    const booking = mapCalBookingToBooking(data, params.providerId ?? this.defaultProviderId);
    if (!booking.startAt) booking.startAt = params.startAt;
    if (!booking.endAt) booking.endAt = params.endAt;
    return booking;
  }

  async cancelBooking(bookingId: string): Promise<void> {
    const url = new URL(`${CAL_API_BASE}/bookings/${encodeURIComponent(bookingId)}`);
    url.searchParams.set("apiKey", this.apiKey);

    const res = await fetch(url.toString(), { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Cal.com cancel booking ${res.status}`);
    }
  }

  async getBooking(bookingId: string): Promise<Booking> {
    const url = new URL(`${CAL_API_BASE}/bookings/${encodeURIComponent(bookingId)}`);
    url.searchParams.set("apiKey", this.apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Cal.com get booking ${res.status}`);
    }

    const data = (await res.json()) as CalBookingResponse;
    return mapCalBookingToBooking(data, this.defaultProviderId);
  }
}
