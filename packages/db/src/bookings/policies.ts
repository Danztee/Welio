import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Database } from "../connection";
import { workspaces, services, staff, timeOff, appointments } from "../schema";
import type {
  PolicyInput,
  TimeOffInput,
} from "@welio/domain/bookings/contract";
import { BookingError } from "@welio/domain/bookings/errors";
import { AppointmentStatus } from "@welio/domain/bookings/enums";
import { plusDays, instantFor } from "@welio/domain/bookings/time";
import { catalogIn, lockedWorkspace } from "./catalog";

export async function savePolicies(
  db: Database,
  userId: string,
  workspaceId: string,
  input: PolicyInput,
) {
  const v = input;
  await db.transaction(async (tx) => {
    await lockedWorkspace(tx, { userId, workspaceId });
    await tx.update(workspaces).set(v).where(eq(workspaces.id, workspaceId));
  });
}

export async function publishBooking(
  db: Database,
  userId: string,
  workspaceId: string,
  published: boolean,
  now = new Date(),
) {
  await db.transaction(async (tx) => {
    const w = await lockedWorkspace(tx, { userId, workspaceId });
    if (published) {
      const locationConfigured =
        w.bookingLocation === "customer_address"
          ? w.serviceArea?.trim()
          : w.businessAddress?.trim();
      if (!w.contactEmail || !locationConfigured)
        throw new BookingError(
          "Add a contact email and service area or business address in Settings before publishing.",
        );

      const activeServices = await tx
        .select({ id: services.id })
        .from(services)
        .where(
          and(eq(services.workspaceId, w.id), eq(services.isActive, true)),
        );
      if (!activeServices.length)
        throw new BookingError("Add an active service before publishing.");

      const catalog = await catalogIn(tx, w, now);
      if (!catalog.staff.length)
        throw new BookingError("Add an active team member before publishing.");

      if (!catalog.services.length)
        throw new BookingError(
          "Assign an active team member to at least one active service before publishing.",
        );
    }

    await tx
      .update(workspaces)
      .set({ isPublished: published })
      .where(eq(workspaces.id, workspaceId));
  });
}

export async function saveTimeOff(
  db: Database,
  userId: string,
  workspaceId: string,
  input: TimeOffInput,
  now = new Date(),
) {
  const v = input;
  await db.transaction(async (tx) => {
    const w = await lockedWorkspace(tx, { userId, workspaceId });
    const from = instantFor(v.from, "00:00", w.timeZone);
    const to = instantFor(plusDays(v.to, 1), "00:00", w.timeZone);
    const [t] = await tx
      .select()
      .from(staff)
      .where(and(eq(staff.id, v.staffId), eq(staff.workspaceId, w.id)));
    if (!t) throw new BookingError("Staff member unavailable.", "not_found");

    const existing = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.workspaceId, w.id),
          eq(appointments.staffId, t.id),
          eq(appointments.status, AppointmentStatus.Confirmed),
          gt(appointments.endsAt, now),
          sql`${appointments.startsAt} - (${appointments.bufferBeforeMinutes} * interval '1 minute') < ${to}`,
          sql`${appointments.endsAt} + (${appointments.bufferAfterMinutes} * interval '1 minute') > ${from}`,
        ),
      );
    if (existing.length)
      throw new BookingError(
        "Reschedule existing appointments in this period before adding time off.",
      );

    await tx.insert(timeOff).values({ ...v, workspaceId });
  });
}

export async function removeTimeOff(
  db: Database,
  userId: string,
  workspaceId: string,
  id: string,
) {
  await db.transaction(async (tx) => {
    await lockedWorkspace(tx, { userId, workspaceId });
    await tx
      .delete(timeOff)
      .where(and(eq(timeOff.id, id), eq(timeOff.workspaceId, workspaceId)));
  });
}
