import {
  defaultReceptionistSettings,
  type ReceptionistSettings,
} from "@/lib/receptionist/settings";
import { sql } from "drizzle-orm";
import type { MessageData } from "@strands-agents/sdk";
import type { ChatTurn, Proposal } from "@/lib/receptionist/contract";
import {
  boolean,
  date,
  bigint,
  jsonb,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const membershipRole = pgEnum("membership_role", ["owner", "staff"]);
export const appointmentStatus = pgEnum("appointment_status", [
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`)],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    logo: text("logo"),
    slug: varchar("slug", { length: 80 }).notNull().unique(),
    timeZone: text("time_zone").default("Africa/Lagos").notNull(),
    currency: varchar("currency", { length: 3 }).default("NGN").notNull(),
    contactEmail: text("contact_email"),
    serviceArea: text("service_area"),
    isPublished: boolean("is_published").default(false).notNull(),
    phone: text("phone").default("").notNull(),
    onboarded: boolean("onboarded").default(false).notNull(),
    leadHours: integer("lead_hours").default(1).notNull(),
    horizonDays: integer("horizon_days").default(60).notNull(),
    cancelHours: integer("cancel_hours").default(24).notNull(),
    slotMinutes: integer("slot_minutes").default(30).notNull(),
    receptionistSettings: jsonb("receptionist_settings")
      .$type<ReceptionistSettings>()
      .default(defaultReceptionistSettings)
      .notNull(),
    remindersEnabled: boolean("reminders_enabled").default(false).notNull(),
    ...timestamps(),
  },
  (t) => [
    check(
      "workspaces_slug_format",
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check("workspaces_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "workspaces_booking_policy",
      sql`${t.leadHours} between 0 and 168 and ${t.horizonDays} between 1 and 365 and ${t.cancelHours} between 0 and 168 and ${t.slotMinutes} in (15,30,60)`,
    ),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: membershipRole("role").notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    durationMinutes: integer("duration_minutes").notNull(),
    bufferBeforeMinutes: integer("buffer_before_minutes").default(0).notNull(),
    bufferAfterMinutes: integer("buffer_after_minutes").default(0).notNull(),
    priceMinor: integer("price_minor").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("services_workspace_id_unique").on(t.workspaceId, t.id),
    check("services_duration_positive", sql`${t.durationMinutes} > 0`),
    check("services_price_nonnegative", sql`${t.priceMinor} >= 0`),
    check(
      "services_buffers_nonnegative",
      sql`${t.bufferBeforeMinutes} >= 0 AND ${t.bufferAfterMinutes} >= 0`,
    ),
  ],
);

export const staff = pgTable(
  "staff",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),
    name: text("name").notNull(),
    email: text("email").default("").notNull(),
    jobTitle: text("job_title").default("Service specialist").notNull(),
    schedule: jsonb("schedule")
      .$type<{
        start: string;
        end: string;
        breakStart: string;
        breakEnd: string;
        days: number[];
      }>()
      .default({
        start: "09:00",
        end: "17:00",
        breakStart: "",
        breakEnd: "",
        days: [1, 2, 3, 4, 5],
      })
      .notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("staff_workspace_id_unique").on(t.workspaceId, t.id),
    unique("staff_workspace_user_unique").on(t.workspaceId, t.userId),
    foreignKey({
      columns: [t.workspaceId, t.userId],
      foreignColumns: [memberships.workspaceId, memberships.userId],
    }),
  ],
);

export const staffServices = pgTable(
  "staff_services",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.staffId, t.serviceId] }),
    index("staff_services_service_idx").on(t.workspaceId, t.serviceId),
    foreignKey({
      columns: [t.workspaceId, t.staffId],
      foreignColumns: [staff.workspaceId, staff.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.serviceId],
      foreignColumns: [services.workspaceId, services.id],
    }),
  ],
);

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
    ...timestamps(),
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
    status: appointmentStatus("status").default("confirmed").notNull(),
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
    // Set by the database trigger, including for raw SQL writes.
    occupiedFrom: timestamp("occupied_from", { withTimezone: true })
      .defaultNow()
      .notNull(),
    occupiedTo: timestamp("occupied_to", { withTimezone: true })
      .defaultNow()
      .notNull(),
    idempotencyKey: text("idempotency_key"),
    ...timestamps(),
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

export const sessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    token: text("token").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...timestamps(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);
export const accounts = pgTable(
  "auth_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps(),
  },
  (t) => [
    index("auth_accounts_user_idx").on(t.userId),
    unique("auth_accounts_provider_unique").on(t.providerId, t.accountId),
  ],
);
export const verifications = pgTable(
  "auth_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [index("auth_verifications_identifier_idx").on(t.identifier)],
);
export const rateLimits = pgTable("auth_rate_limits", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
export const invitations = pgTable(
  "workspace_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: membershipRole("role").default("staff").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("workspace_invitations_workspace_idx").on(t.workspaceId)],
);

export const timeOff = pgTable(
  "staff_time_off",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id").notNull(),
    from: date("from_date").notNull(),
    to: date("to_date").notNull(),
    reason: text("reason").default("Time off").notNull(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.staffId],
      foreignColumns: [staff.workspaceId, staff.id],
    }),
    index("staff_time_off_lookup_idx").on(
      t.workspaceId,
      t.staffId,
      t.from,
      t.to,
    ),
    check("staff_time_off_order", sql`${t.to} >= ${t.from}`),
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
    ...timestamps(),
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
    ...timestamps(),
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

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    messages: jsonb("messages").$type<MessageData[]>().default([]).notNull(),
    turns: jsonb("turns").$type<ChatTurn[]>().default([]).notNull(),
    pending: jsonb("pending").$type<Proposal | null>(),
    receipt: uuid("receipt"),
    lease: uuid("lease"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    index("chat_sessions_expiry_idx").on(t.expiresAt),
    index("chat_sessions_workspace_idx").on(t.workspaceId),
  ],
);
