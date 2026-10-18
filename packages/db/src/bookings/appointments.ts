import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../connection";
import {
  workspaces,
  staff,
  appointments,
  customers,
  bookingOperations,
  emailOutbox,
} from "../schema";
import { authorizeWorkspace } from "../workspaces/repository";
import {
  type BookingInput,
  type ChangeInput,
  type BookingView,
} from "@welio/domain/bookings/contract";
import { BookingError } from "@welio/domain/bookings/errors";
import { AppointmentStatus } from "@welio/domain/bookings/enums";
import { BookingLocation } from "@welio/domain/workspaces/enums";
import {
  availabilityIn,
  fingerprint,
  hash,
  lockedWorkspace,
  quoteFor,
  serviceIn,
} from "./catalog";
import type { Scope, Tx, Workspace } from "./catalog";

export type Appointment = typeof appointments.$inferSelect;

export type Actor = { userId: string } | { token: string };

function checkToken(a: Appointment, token: string, now: Date) {
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    !a.managementTokenHash ||
    a.managementTokenHash !== hash(token) ||
    !a.managementExpiresAt ||
    a.managementExpiresAt <= now
  )
    throw new BookingError(
      "This management link is invalid or expired.",
      "not_found",
    );
}

function publicChangeAllowed(a: Appointment, w: Workspace, now: Date) {
  return (
    a.status === "confirmed" &&
    a.startsAt.getTime() > now.getTime() &&
    a.startsAt.getTime() - now.getTime() >= w.cancelHours * 3600000
  );
}

async function viewIn(
  tx: Tx,
  a: Appointment,
  w: Workspace,
  now: Date,
): Promise<BookingView> {
  const [t] = await tx
    .select({ name: staff.name })
    .from(staff)
    .where(and(eq(staff.id, a.staffId), eq(staff.workspaceId, w.id)));

  return {
    workspaceId: w.id,
    id: a.id,
    version: a.version,
    status: a.status,
    serviceId: a.serviceId,
    staffId: a.staffId,
    serviceName: a.serviceName,
    staffName: t?.name ?? "Team member",
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    timeZone: a.timeZone,
    priceMinor: a.priceMinor,
    currency: a.currency,
    durationMinutes: a.durationMinutes,
    name: a.customerName,
    email: a.customerEmail,
    phone: a.customerPhone,
    address: a.serviceAddress ?? "",
    business: w.name,
    contactEmail: w.contactEmail,
    businessPhone: w.phone,
    canChange: publicChangeAllowed(a, w, now),
    cancelHours: w.cancelHours,
    slug: w.slug,
  };
}

async function emailEvent(
  tx: Tx,
  w: Workspace,
  a: Appointment,
  kind: "confirmed" | "rescheduled" | "cancelled",
  origin: string,
  token?: string,
) {
  const label = {
    confirmed: "Appointment confirmed",
    rescheduled: "Appointment rescheduled",
    cancelled: "Appointment cancelled",
  }[kind];
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: a.timeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(a.startsAt);
  const price = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: a.currency,
  }).format(a.priceMinor / 100);
  await tx
    .insert(emailOutbox)
    .values({
      workspaceId: w.id,
      appointmentId: a.id,
      eventKey: `${a.id}:${kind}:${a.version}`,
      recipient: a.customerEmail,
      subject: `${label} · ${w.name}`,
      body: `${label}\n\n${a.serviceName}\n${when} (${a.timeZone})\n${price}\nAppointment location: ${a.serviceAddress}\n\nChanges and cancellations require ${w.cancelHours} hours’ notice.${token ? `\n\nManage your booking privately:\n${origin}/booking/${a.id}#${token}` : ""}\n\nContact: ${w.contactEmail ?? w.phone}`,
    })
    .onConflictDoNothing();
}

export async function createBooking(
  db: Database,
  scope: Scope,
  input: BookingInput,
  origin: string,
  now = new Date(),
  channel: "form" | "receptionist" = "form",
) {
  const v = input;

  return db.transaction(async (tx) => {
    const w = await lockedWorkspace(tx, scope);
    const serviceLocation =
      w.bookingLocation === BookingLocation.Both
        ? v.serviceLocation
        : w.bookingLocation;
    if (!serviceLocation)
      throw new BookingError("Choose where the appointment will take place.");

    if (
      w.bookingLocation !== BookingLocation.Both &&
      v.serviceLocation &&
      v.serviceLocation !== w.bookingLocation
    )
      throw new BookingError(
        "Appointment location must match this business’s booking settings.",
      );

    const address =
      serviceLocation === BookingLocation.BusinessAddress
        ? w.businessAddress?.trim()
        : v.address;
    if (!address)
      throw new BookingError(
        serviceLocation === BookingLocation.BusinessAddress
          ? "Add your business address in Settings before accepting bookings."
          : "Enter the service address.",
      );

    const requestFingerprint = fingerprint({
      v: { ...v, serviceLocation, address },
      actor: scope.userId ?? "public",
    });
    const [old] = await tx
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.workspaceId, w.id),
          eq(appointments.idempotencyKey, v.key),
        ),
      );
    if (old) {
      if (old.requestFingerprint !== requestFingerprint)
        throw new BookingError(
          "This request key was already used for different booking details.",
        );

      return { id: old.id };
    }

    if (
      channel === "receptionist" &&
      (!w.receptionistSettings.enabled ||
        !w.receptionistSettings.allowBooking ||
        !w.receptionistSettings.allowAvailability)
    )
      throw new BookingError(
        "The receptionist is no longer accepting booking requests. Please use the booking form.",
      );

    const s = await serviceIn(tx, w, v.serviceId);
    if (quoteFor(s, w) !== v.quote)
      throw new BookingError(
        "The service or price changed. Refresh the page and review it again.",
      );

    const available = await availabilityIn(
      tx,
      w,
      s,
      v.date,
      v.staffId,
      "",
      now,
    );
    const slot = available.find(
      (slot) => slot.time === v.time && slot.staffId === v.staffId,
    );
    if (!slot)
      throw new BookingError(
        "That time is no longer available. Choose another slot.",
      );

    let [c] = await tx
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.workspaceId, w.id),
          sql`lower(${customers.email})=${v.email}`,
        ),
      )
      .orderBy(customers.createdAt)
      .limit(1);
    if (!c) {
      [c] = await tx
        .insert(customers)
        .values({
          workspaceId: w.id,
          name: v.name,
          email: v.email,
          phone: v.phone,
        })
        .returning();
    }

    const start = new Date(slot.startsAt),
      token = randomBytes(32).toString("base64url");
    const [a] = await tx
      .insert(appointments)
      .values({
        workspaceId: w.id,
        customerId: c.id,
        serviceId: s.id,
        staffId: v.staffId,
        startsAt: start,
        endsAt: new Date(start.getTime() + s.durationMinutes * 60000),
        serviceName: s.name,
        durationMinutes: s.durationMinutes,
        bufferBeforeMinutes: s.bufferBeforeMinutes,
        bufferAfterMinutes: s.bufferAfterMinutes,
        priceMinor: s.priceMinor,
        currency: w.currency,
        serviceAddress: address,
        customerName: v.name,
        customerEmail: v.email,
        customerPhone: v.phone,
        notificationConsent: v.consent,
        timeZone: w.timeZone,
        source: scope.userId ? "owner" : "public",
        idempotencyKey: v.key,
        requestFingerprint,
        managementTokenHash: hash(token),
        managementExpiresAt: new Date(start.getTime() + 30 * 86400000),
      })
      .returning();
    await emailEvent(tx, w, a, "confirmed", origin, token);

    return { id: a.id };
  });
}

async function authorizedBooking(tx: Tx, id: string, actor: Actor, now: Date) {
  const [initial] = await tx
    .select({ workspaceId: appointments.workspaceId })
    .from(appointments)
    .where(eq(appointments.id, id));
  if (!initial)
    throw new BookingError(
      "token" in actor
        ? "This management link is invalid or expired."
        : "Booking unavailable.",
      "not_found",
    );

  if ("userId" in actor)
    await authorizeWorkspace(tx, actor.userId, initial.workspaceId, true);

  const [w] = await tx
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, initial.workspaceId))
    .for("update");
  const [a] = await tx
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, id), eq(appointments.workspaceId, w.id)))
    .for("update");
  if ("token" in actor) checkToken(a, actor.token, now);

  return { a, w };
}

export async function getBooking(
  db: Database,
  id: string,
  actor: Actor,
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const { a, w } = await authorizedBooking(tx, id, actor, now);

    return viewIn(tx, a, w, now);
  });
}

export async function changeAvailability(
  db: Database,
  id: string,
  actor: Actor,
  date: string,
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const { a, w } = await authorizedBooking(tx, id, actor, now);
    if (a.status !== "confirmed")
      throw new BookingError("This appointment is already closed.");

    if ("token" in actor && !publicChangeAllowed(a, w, now))
      throw new BookingError(
        "Contact the business to change this appointment inside the cancellation window.",
      );

    return availabilityIn(
      tx,
      w,
      {
        id: a.serviceId,
        durationMinutes: a.durationMinutes,
        bufferBeforeMinutes: a.bufferBeforeMinutes,
        bufferAfterMinutes: a.bufferAfterMinutes,
      },
      date,
      undefined,
      a.id,
      now,
    );
  });
}

export async function changeBooking(
  db: Database,
  id: string,
  actor: Actor,
  input: ChangeInput,
  origin: string,
  now = new Date(),
) {
  const v = input;

  return db.transaction(async (tx) => {
    const { a, w } = await authorizedBooking(tx, id, actor, now);
    const identity = "userId" in actor ? actor.userId : a.managementTokenHash;
    const fp = fingerprint({ id, actor: identity, v });
    const [old] = await tx
      .select()
      .from(bookingOperations)
      .where(
        and(
          eq(bookingOperations.workspaceId, w.id),
          eq(bookingOperations.key, v.key),
        ),
      );
    if (old) {
      if (old.fingerprint !== fp)
        throw new BookingError(
          "This request key was already used for another action.",
        );

      return { id: a.id };
    }

    if (a.version !== v.version)
      throw new BookingError(
        "This booking changed. Reload its details before trying again.",
      );

    if (a.status !== "confirmed")
      throw new BookingError("This appointment is already closed.");

    if ("token" in actor) {
      if (!["reschedule", "cancel"].includes(v.action))
        throw new BookingError("This action is unavailable.", "forbidden");

      if (!publicChangeAllowed(a, w, now))
        throw new BookingError(
          "Contact the business to make changes inside the cancellation window.",
        );
    }

    let values: Partial<typeof appointments.$inferInsert> = {
      version: a.version + 1,
    };
    if (v.action === "reschedule") {
      const available = await availabilityIn(
        tx,
        w,
        {
          id: a.serviceId,
          durationMinutes: a.durationMinutes,
          bufferBeforeMinutes: a.bufferBeforeMinutes,
          bufferAfterMinutes: a.bufferAfterMinutes,
        },
        v.date!,
        v.staffId,
        a.id,
        now,
      );
      const slot = available.find(
        (slot) => slot.time === v.time && slot.staffId === v.staffId,
      );
      if (!slot)
        throw new BookingError(
          "That time is no longer available. Your original booking is unchanged.",
        );

      const start = new Date(slot.startsAt);
      values = {
        ...values,
        startsAt: start,
        endsAt: new Date(start.getTime() + a.durationMinutes * 60000),
        managementExpiresAt: new Date(start.getTime() + 30 * 86400000),
        staffId: v.staffId,
      };
    } else {
      if (["completed", "no_show"].includes(v.action) && now < a.startsAt)
        throw new BookingError(
          "Wait until the appointment starts before marking it completed or no-show.",
        );

      values.status =
        v.action === "cancel"
          ? AppointmentStatus.Cancelled
          : v.action === "completed"
            ? AppointmentStatus.Completed
            : AppointmentStatus.NoShow;
    }

    const [updated] = await tx
      .update(appointments)
      .set(values)
      .where(eq(appointments.id, a.id))
      .returning();
    await tx
      .update(emailOutbox)
      .set({ status: "skipped" })
      .where(
        and(
          eq(emailOutbox.workspaceId, w.id),
          eq(emailOutbox.appointmentId, a.id),
          eq(emailOutbox.kind, "reminder"),
          inArray(emailOutbox.status, ["queued", "failed"]),
        ),
      );
    await tx.insert(bookingOperations).values({
      workspaceId: w.id,
      key: v.key,
      appointmentId: a.id,
      fingerprint: fp,
    });
    if (v.action === "reschedule" || v.action === "cancel")
      await emailEvent(
        tx,
        w,
        updated,
        v.action === "cancel" ? "cancelled" : "rescheduled",
        origin,
        "token" in actor ? actor.token : undefined,
      );

    return { id: a.id };
  });
}
