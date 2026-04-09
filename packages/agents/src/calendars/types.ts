export type ProviderKind =
  | "google_calendar"
  | "cal_com"
  | "calendly"
  | "square_appointments"
  | "acuity"
  | "callback_only";

export type Slot = {
  startAt: string;
  endAt: string;
  providerId?: string;
  calendarId?: string;
  raw?: unknown;
};

export type Provider = {
  id: string;
  name: string;
  email?: string;
  calendarId?: string;
  active: boolean;
};

export type BookingStatus = "confirmed" | "cancelled";

export type Booking = {
  id: string;
  providerBookingId?: string;
  startAt: string;
  endAt: string;
  providerId?: string;
  status: BookingStatus;
  raw?: unknown;
};

export type GetAvailableSlotsParams = {
  calendarId?: string;
  providerId?: string;
  startAt: string;
  endAt: string;
  timeZone?: string;
};

export type CreateBookingParams = {
  calendarId?: string;
  providerId?: string;
  startAt: string;
  endAt: string;
  name: string;
  email: string;
  notes?: string;
  timeZone?: string;
};

export interface CalendarAdapter {
  getAvailableSlots(params: GetAvailableSlotsParams): Promise<Slot[]>;
  getProviders(): Promise<Provider[]>;
  createBooking(params: CreateBookingParams): Promise<Booking>;
  cancelBooking(bookingId: string): Promise<void>;
  getBooking(bookingId: string): Promise<Booking>;
}
