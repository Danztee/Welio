import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  jsonb,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaces, memberships } from "./workspaces";

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
