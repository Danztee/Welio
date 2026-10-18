import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../connection";
import {
  workspaces,
  services,
  staff,
  staffServices,
  timeOff,
  appointments,
} from "../schema";
import { authorizeWorkspace } from "../workspaces/repository";
import type { Catalog, SlotInput } from "@welio/domain/bookings/contract";
import { BookingError } from "@welio/domain/bookings/errors";
import { AppointmentStatus } from "@welio/domain/bookings/enums";
import { findAvailableSlots } from "@welio/domain/bookings/availability";
import { instantFor, localDate, plusDays } from "@welio/domain/bookings/time";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type Workspace = typeof workspaces.$inferSelect;

export type Service = typeof services.$inferSelect;

export type Scope =
  | { slug: string; userId?: never; workspaceId?: never }
  | { userId: string; workspaceId: string; slug?: never };

export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export const fingerprint = (value: unknown) => hash(JSON.stringify(value));

export const quoteFor = (s: Service, w: Workspace) =>
  fingerprint({
    id: s.id,
    name: s.name,
    price: s.priceMinor,
    duration: s.durationMinutes,
    before: s.bufferBeforeMinutes,
    after: s.bufferAfterMinutes,
    active: s.isActive,
    currency: w.currency,
    zone: w.timeZone,
    bookingLocation: w.bookingLocation,
    serviceArea: w.serviceArea,
  });

export async function lockedWorkspace(tx: Tx, scope: Scope) {
  if (scope.userId)
    await authorizeWorkspace(tx, scope.userId, scope.workspaceId, true);

  const [w] = await tx
    .select()
    .from(workspaces)
    .where(
      scope.slug
        ? eq(workspaces.slug, scope.slug)
        : eq(workspaces.id, scope.workspaceId!),
    )
    .for("update");
  if (!w || (!scope.userId && !w.isPublished))
    throw new BookingError("This booking page is unavailable.", "not_found");

  return w;
}

export async function catalogIn(
  tx: Tx,
  w: Workspace,
  now: Date,
): Promise<Catalog> {
  const team = await tx
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(and(eq(staff.workspaceId, w.id), eq(staff.isActive, true)));
  const assignments = await tx
    .select()
    .from(staffServices)
    .where(
      and(
        eq(staffServices.workspaceId, w.id),
        eq(staffServices.isActive, true),
      ),
    );
  const list = await tx
    .select()
    .from(services)
    .where(and(eq(services.workspaceId, w.id), eq(services.isActive, true)));
  const today = localDate(now, w.timeZone);

  return {
    id: w.id,
    name: w.name,
    logo: w.logo,
    slug: w.slug,
    contactEmail: w.contactEmail,
    phone: w.phone,
    serviceArea: w.serviceArea,
    bookingLocation: w.bookingLocation,
    timeZone: w.timeZone,
    currency: w.currency,
    leadHours: w.leadHours,
    horizonDays: w.horizonDays,
    cancelHours: w.cancelHours,
    slotMinutes: w.slotMinutes,
    today,
    maxDate: plusDays(today, w.horizonDays),
    services: list
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        durationMinutes: s.durationMinutes,
        priceMinor: s.priceMinor,
        quote: quoteFor(s, w),
        staffIds: assignments
          .filter(
            (a) => a.serviceId === s.id && team.some((t) => t.id === a.staffId),
          )
          .map((a) => a.staffId),
      }))
      .filter((s) => s.staffIds.length),
    staff: team,
  };
}

export async function getCatalog(db: Database, scope: Scope, now = new Date()) {
  return db.transaction(async (tx) =>
    catalogIn(tx, await lockedWorkspace(tx, scope), now),
  );
}

export async function serviceIn(tx: Tx, w: Workspace, id: string) {
  const [s] = await tx
    .select()
    .from(services)
    .where(
      and(
        eq(services.id, id),
        eq(services.workspaceId, w.id),
        eq(services.isActive, true),
      ),
    );
  if (!s)
    throw new BookingError(
      "This service is no longer available. Refresh the page.",
    );

  return s;
}

export async function availabilityIn(
  tx: Tx,
  w: Workspace,
  s: Pick<
    Service,
    "id" | "durationMinutes" | "bufferBeforeMinutes" | "bufferAfterMinutes"
  >,
  date: string,
  staffId: string | undefined,
  exclude: string,
  now: Date,
) {
  const dayStart = instantFor(date, "00:00", w.timeZone),
    nextDay = instantFor(plusDays(date, 1), "00:00", w.timeZone);
  const workers = await tx
    .select({ id: staff.id, schedule: staff.schedule })
    .from(staff)
    .innerJoin(
      staffServices,
      and(
        eq(staffServices.staffId, staff.id),
        eq(staffServices.workspaceId, w.id),
        eq(staffServices.serviceId, s.id),
        eq(staffServices.isActive, true),
      ),
    )
    .where(
      and(
        eq(staff.workspaceId, w.id),
        eq(staff.isActive, true),
        ...(staffId ? [eq(staff.id, staffId)] : []),
      ),
    )
    .orderBy(staff.id);
  const leave = await tx
    .select()
    .from(timeOff)
    .where(
      and(
        eq(timeOff.workspaceId, w.id),
        sql`${timeOff.from}<=${date}`,
        sql`${timeOff.to}>=${date}`,
      ),
    );
  const occupied = await tx
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.workspaceId, w.id),
        inArray(appointments.status, [
          AppointmentStatus.Confirmed,
          AppointmentStatus.Completed,
        ]),
        sql`${appointments.startsAt} - (${appointments.bufferBeforeMinutes} * interval '1 minute') < ${nextDay}`,
        sql`${appointments.endsAt} + (${appointments.bufferAfterMinutes} * interval '1 minute') > ${dayStart}`,
      ),
    );

  return findAvailableSlots({
    workspace: w,
    service: s,
    date,
    staffId,
    excludeAppointmentId: exclude,
    now,
    workers,
    timeOff: leave,
    appointments: occupied,
  });
}

export async function getAvailability(
  db: Database,
  scope: Scope,
  input: SlotInput,
  now = new Date(),
) {
  const v = input;

  return db.transaction(async (tx) => {
    const w = await lockedWorkspace(tx, scope);
    const s = await serviceIn(tx, w, v.serviceId);

    return availabilityIn(tx, w, s, v.date, v.staffId, "", now);
  });
}
