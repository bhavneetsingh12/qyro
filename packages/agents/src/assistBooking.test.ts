import test from "node:test";
import assert from "node:assert/strict";

import { normalizeBookingMode } from "./bookingMode";

test("booking mode falls back to booking_link_sms for calendly", () => {
  const mode = normalizeBookingMode(undefined, "calendly");
  assert.equal(mode, "booking_link_sms");
});

test("booking mode falls back to callback_only for callback provider", () => {
  const mode = normalizeBookingMode(undefined, "callback_only");
  assert.equal(mode, "callback_only");
});

test("booking mode falls back to direct_booking for direct providers", () => {
  const mode = normalizeBookingMode(undefined, "cal_com");
  assert.equal(mode, "direct_booking");
});
