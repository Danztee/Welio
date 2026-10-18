import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/connection";
import {
  workspaces,
  services,
  staff,
  staffServices,
  timeOff,
  appointments,
  customers,
  bookingOperations,
  emailOutbox,
} from "@/db/schema";
import { authorizeWorkspace } from "@/lib/workspaces/repository";
import {
  bookingInput,
  changeInput,
  slotInput,
  policyInput,
  timeOffInput,
  type Catalog,
  type Slot,
  type BookingView,
} from "./contract";
import { localDate, plusDays, instantFor, weekday } from "./time";
export class BookingError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
// Drizzle uses one pg client per transaction, so await its queries in sequence.
type Workspace = typeof workspaces.$inferSelect;
type Service = typeof services.$inferSelect;
type Appointment = typeof appointments.$inferSelect;
type Scope =
  | { slug: string; userId?: never; workspaceId?: never }
  | { userId: string; workspaceId: string; slug?: never };
export type Actor = { userId: string } | { token: string };
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const fingerprint = (value: unknown) => hash(JSON.stringify(value));
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
    throw new BookingError("This booking page is unavailable.", 404);
  return w;
}
async function catalogIn(tx: Tx, w: Workspace, now: Date): Promise<Catalog> {
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
async function serviceIn(tx: Tx, w: Workspace, id: string) {
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
async function availabilityIn(
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
  const today = localDate(now, w.timeZone);
  if (date < today || date > plusDays(today, w.horizonDays))
    throw new BookingError("Choose a date within the booking window.", 400);
  const dayStart = instantFor(date, "00:00", w.timeZone),
    nextDay = instantFor(plusDays(date, 1), "00:00", w.timeZone);
  const workers = await tx
    .select({ member: staff })
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
        inArray(appointments.status, ["confirmed", "completed"]),
        lt(appointments.occupiedFrom, nextDay),
        gt(appointments.occupiedTo, dayStart),
      ),
    );
  const result: Slot[] = [];
  for (let minute = 0; minute < 1440; minute += w.slotMinutes) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    let start: Date;
    try {
      start = instantFor(date, time, w.timeZone);
    } catch {
      continue;
    }
    if (start.getTime() < now.getTime() + w.leadHours * 3600000) continue;
    const from = new Date(start.getTime() - s.bufferBeforeMinutes * 60000),
      to = new Date(
        start.getTime() + (s.durationMinutes + s.bufferAfterMinutes) * 60000,
      );
    for (const { member: t } of workers) {
      const schedule = t.schedule;
      if (
        !schedule.days.includes(weekday(date)) ||
        leave.some((l) => l.staffId === t.id)
      )
        continue;
      let opens: Date, closes: Date;
      try {
        opens = instantFor(date, schedule.start, w.timeZone);
        closes = instantFor(date, schedule.end, w.timeZone);
      } catch {
        continue;
      }
      if (from < opens || to > closes) continue;
      if (schedule.breakStart && schedule.breakEnd) {
        try {
          if (
            from < instantFor(date, schedule.breakEnd, w.timeZone) &&
            to > instantFor(date, schedule.breakStart, w.timeZone)
          )
            continue;
        } catch {
          continue;
        }
      }
      if (
        occupied.some(
          (a) =>
            a.id !== exclude &&
            a.staffId === t.id &&
            from < a.occupiedTo &&
            to > a.occupiedFrom,
        )
      )
        continue;
      result.push({ time, staffId: t.id, startsAt: start.toISOString() });
    }
  }
  return result;
}
export async function getAvailability(
  db: Database,
  scope: Scope,
  input: unknown,
  now = new Date(),
) {
  const v = slotInput.parse(input);
  return db.transaction(async (tx) => {
    const w = await lockedWorkspace(tx, scope);
    const s = await serviceIn(tx, w, v.serviceId);
    return availabilityIn(tx, w, s, v.date, v.staffId, "", now);
  });
}
function checkToken(a: Appointment, token: string, now: Date) {
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    !a.managementTokenHash ||
    a.managementTokenHash !== hash(token) ||
    !a.managementExpiresAt ||
    a.managementExpiresAt <= now
  )
    throw new BookingError("This management link is invalid or expired.", 404);
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
      body: `${label}\n\n${a.serviceName}\n${when} (${a.timeZone})\n${price}\nAddress: ${a.serviceAddress}\n\nChanges and cancellations require ${w.cancelHours} hours’ notice.${token ? `\n\nManage your booking privately:\n${origin}/booking/${a.id}#${token}` : ""}\n\nContact: ${w.contactEmail ?? w.phone}`,
    })
    .onConflictDoNothing();
}
export async function createBooking(
  db: Database,
  scope: Scope,
  input: unknown,
  origin: string,
  now = new Date(),
  channel: "form" | "receptionist" = "form",
) {
  const v = bookingInput.parse(input);
  return db.transaction(async (tx) => {
    const w = await lockedWorkspace(tx, scope);
    const requestFingerprint = fingerprint({
      v,
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
        serviceAddress: v.address,
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
      404,
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
  input: unknown,
  origin: string,
  now = new Date(),
) {
  const v = changeInput.parse(input);
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
        throw new BookingError("This action is unavailable.", 403);
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
      values.status = v.action === "cancel" ? "cancelled" : v.action;
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
export async function savePolicies(
  db: Database,
  userId: string,
  workspaceId: string,
  input: unknown,
) {
  const v = policyInput.parse(input);
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
      if (!w.contactEmail || !w.serviceArea?.trim())
        throw new BookingError(
          "Add a contact email and service area in Settings before publishing.",
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
  input: unknown,
  now = new Date(),
) {
  const v = timeOffInput.parse(input);
  await db.transaction(async (tx) => {
    const w = await lockedWorkspace(tx, { userId, workspaceId });
    const [t] = await tx
      .select()
      .from(staff)
      .where(and(eq(staff.id, v.staffId), eq(staff.workspaceId, w.id)));
    if (!t) throw new BookingError("Staff member unavailable.", 404);
    const existing = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.workspaceId, w.id),
          eq(appointments.staffId, t.id),
          eq(appointments.status, "confirmed"),
          gt(appointments.endsAt, now),
          lt(
            appointments.occupiedFrom,
            instantFor(plusDays(v.to, 1), "00:00", w.timeZone),
          ),
          gt(appointments.occupiedTo, instantFor(v.from, "00:00", w.timeZone)),
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
