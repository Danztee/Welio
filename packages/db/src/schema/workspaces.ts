import {
  defaultReceptionistSettings,
  type ReceptionistSettings,
} from "@welio/domain/receptionist/settings";
import { sql } from "drizzle-orm";
import {
  boolean,
  jsonb,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  BookingLocation,
  MembershipRole,
} from "@welio/domain/workspaces/enums";
import { users } from "./identity";

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
    bookingLocation: text("booking_location")
      .$type<BookingLocation>()
      .default(BookingLocation.CustomerAddress)
      .notNull(),
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
  },
  (t) => [
    check(
      "workspaces_slug_format",
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check("workspaces_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "workspaces_booking_location_valid",
      sql`${t.bookingLocation} in ('customer_address','business_address')`,
    ),
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
    role: text("role").$type<MembershipRole>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("memberships_user_idx").on(t.userId),
    check("memberships_role_valid", sql`${t.role} in ('owner','staff')`),
  ],
);

export const invitations = pgTable(
  "workspace_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role")
      .$type<MembershipRole>()
      .default(MembershipRole.Staff)
      .notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("workspace_invitations_workspace_idx").on(t.workspaceId),
    check(
      "workspace_invitations_role_valid",
      sql`${t.role} in ('owner','staff')`,
    ),
  ],
);
