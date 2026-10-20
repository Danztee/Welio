import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingSelectionFromLink } from "../../src/lib/domain/bookings/waitlist-link.ts";

const catalog = {
  today: "2026-10-20",
  maxDate: "2026-11-20",
  services: [{ id: "service-a", staffIds: ["staff-a"] }],
};

test("waitlist link preselects a valid service, date, and staff member", () => {
  assert.deepEqual(
    bookingSelectionFromLink(catalog, {
      service: "service-a",
      date: "2026-10-22",
      staff: "staff-a",
    }),
    { serviceId: "service-a", date: "2026-10-22", staffId: "staff-a" },
  );
});

test("waitlist link ignores invalid or outdated selections", () => {
  assert.equal(
    bookingSelectionFromLink(catalog, {
      service: "missing",
      date: "2026-10-22",
    }),
    undefined,
  );
  assert.equal(
    bookingSelectionFromLink(catalog, {
      service: "service-a",
      date: "2026-10-19",
    }),
    undefined,
  );
  assert.deepEqual(
    bookingSelectionFromLink(catalog, {
      service: "service-a",
      date: "2026-10-22",
      staff: "someone-else",
    }),
    { serviceId: "service-a", date: "2026-10-22", staffId: "" },
  );
});
