import "server-only";

import { sql } from "drizzle-orm";
import type { Database } from "./connection";
import {
  accounts,
  appointments,
  bookingOperations,
  chatSessions,
  emailOutbox,
  invitations,
  memberships,
  rateLimits,
  sessions,
  timeOff,
  users,
  verifications,
  workspaces,
} from "./schema";

export async function checkDatabaseReadiness(db: Database) {
  await db.execute(sql`
    SELECT
      ${users.firstName},
      ${users.lastName},
      ${users.emailVerified},
      ${workspaces.onboarded},
      ${workspaces.remindersEnabled},
      ${appointments.notificationConsent},
      ${emailOutbox.kind},
      ${chatSessions.pending}
    FROM ${workspaces}, ${memberships}, ${appointments}, ${users}, ${sessions},
      ${accounts}, ${verifications}, ${rateLimits}, ${invitations}, ${timeOff},
      ${emailOutbox}, ${bookingOperations}, ${chatSessions}
    LIMIT 0
  `);
}
