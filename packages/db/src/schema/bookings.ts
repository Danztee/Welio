import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { AppointmentStatus } from "@welio/domain/bookings/enums";
import { workspaces } from "./workspaces";
import { staffServices } from "./scheduling";

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique("customers_workspace_id_unique").on(t.workspaceId, t.id),
    index("customers_workspace_email_idx").on(
      t.workspaceId,
      sql`lower(${t.email})`,
    ),
  ],
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    status: text("status")
      .$type<AppointmentStatus>()
      .default(AppointmentStatus.Confirmed)
      .notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    serviceName: text("service_name").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    bufferBeforeMinutes: integer("buffer_before_minutes").default(0).notNull(),
    bufferAfterMinutes: integer("buffer_after_minutes").default(0).notNull(),
    priceMinor: integer("price_minor").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    serviceAddress: text("service_address"),
    customerName: text("customer_name").default("").notNull(),
    customerEmail: text("customer_email").default("").notNull(),
    customerPhone: text("customer_phone").default("").notNull(),
    notificationConsent: boolean("notification_consent")
      .default(false)
      .notNull(),
    timeZone: text("time_zone").default("Africa/Lagos").notNull(),
    source: text("source").default("owner").notNull(),
    version: integer("version").default(0).notNull(),
    requestFingerprint: text("request_fingerprint"),
    managementTokenHash: text("management_token_hash"),
    managementExpiresAt: timestamp("management_expires_at", {
      withTimezone: true,
    }),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique("appointments_workspace_id_unique").on(t.workspaceId, t.id),
    unique("appointments_workspace_idempotency_unique").on(
      t.workspaceId,
      t.idempotencyKey,
    ),
    index("appointments_workspace_starts_idx").on(t.workspaceId, t.startsAt),
    index("appointments_reminders_due_idx").on(t.status, t.startsAt),
    index("appointments_customer_idx").on(t.workspaceId, t.customerId),
    index("appointments_service_idx").on(t.workspaceId, t.serviceId),
    index("appointments_staff_service_idx").on(
      t.workspaceId,
      t.staffId,
      t.serviceId,
    ),
    foreignKey({
      columns: [t.workspaceId, t.customerId],
      foreignColumns: [customers.workspaceId, customers.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.staffId, t.serviceId],
      foreignColumns: [
        staffServices.workspaceId,
        staffServices.staffId,
        staffServices.serviceId,
      ],
    }),
    check("appointments_time_order", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "appointments_status_valid",
      sql`${t.status} in ('confirmed','completed','cancelled','no_show')`,
    ),
    check("appointments_duration_positive", sql`${t.durationMinutes} > 0`),
    check(
      "appointments_duration_matches_interval",
      sql`${t.endsAt} - ${t.startsAt} = ${t.durationMinutes} * interval '1 minute'`,
    ),
    check("appointments_price_nonnegative", sql`${t.priceMinor} >= 0`),
    check(
      "appointments_buffers_nonnegative",
      sql`${t.bufferBeforeMinutes} >= 0 AND ${t.bufferAfterMinutes} >= 0`,
    ),
    check("appointments_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const bookingOperations = pgTable(
  "booking_operations",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    appointmentId: uuid("appointment_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.key] }),
    foreignKey({
      columns: [t.workspaceId, t.appointmentId],
      foreignColumns: [appointments.workspaceId, appointments.id],
    }),
  ],
);

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").notNull(),
    eventKey: text("event_key").notNull().unique(),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    kind: text("kind").default("transactional").notNull(),
    appointmentVersion: integer("appointment_version"),
    status: text("status").default("queued").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.appointmentId],
      foreignColumns: [appointments.workspaceId, appointments.id],
    }),
    index("email_outbox_queue_idx").on(t.status, t.createdAt),
    check(
      "email_outbox_status",
      sql`${t.status} in ('queued','sending','sent','failed','skipped')`,
    ),
    check(
      "email_outbox_kind",
      sql`${t.kind} in ('transactional','reminder') and (${t.kind} <> 'reminder' or ${t.appointmentVersion} is not null)`,
    ),
  ],
);
