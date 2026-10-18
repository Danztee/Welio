import type {
  ChatRetry,
  ChatTurn,
  ExternalBookingProposal,
  Proposal,
  StoredConversationMessage,
} from "@welio/domain/receptionist/contract";
import {
  jsonb,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { appointments } from "./bookings";

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    messages: jsonb("messages")
      .$type<StoredConversationMessage[]>()
      .default([])
      .notNull(),
    turns: jsonb("turns").$type<ChatTurn[]>().default([]).notNull(),
    activeTurn: jsonb("active_turn").$type<ChatRetry | null>(),
    pending: jsonb("pending").$type<Proposal | null>(),
    receipt: uuid("receipt"),
    lease: uuid("lease"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("chat_sessions_expiry_idx").on(t.expiresAt),
    index("chat_sessions_workspace_idx").on(t.workspaceId),
  ],
);

export const mcpBookingProposals = pgTable(
  "mcp_booking_proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    approvalTokenHash: text("approval_token_hash").notNull().unique(),
    proposal: jsonb("proposal").$type<ExternalBookingProposal | null>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    confirmedAppointmentId: uuid("confirmed_appointment_id"),
    confirmationLease: uuid("confirmation_lease"),
    confirmationLeaseUntil: timestamp("confirmation_lease_until", {
      withTimezone: true,
    }),
  },
  (t) => [
    unique("mcp_booking_proposals_workspace_idempotency_unique").on(
      t.workspaceId,
      t.idempotencyKey,
    ),
    foreignKey({
      columns: [t.workspaceId, t.confirmedAppointmentId],
      foreignColumns: [appointments.workspaceId, appointments.id],
    }),
    index("mcp_booking_proposals_workspace_idx").on(t.workspaceId),
    index("mcp_booking_proposals_expiry_idx").on(t.expiresAt),
  ],
);
