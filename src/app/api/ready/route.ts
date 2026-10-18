import { sql } from "drizzle-orm";

import { getDatabase } from "@/db";
import {
  appointments,
  memberships,
  workspaces,
  users,
  sessions,
  accounts,
  verifications,
  rateLimits,
  invitations,
  timeOff,
  emailOutbox,
  bookingOperations,
  chatSessions,
} from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };

  try {
    await getDatabase().execute(sql`
      SELECT ${users.firstName}, ${users.lastName}, ${users.emailVerified}, ${workspaces.onboarded}, ${workspaces.remindersEnabled}, ${appointments.notificationConsent}, ${appointments.occupiedFrom}, ${emailOutbox.kind}, ${chatSessions.pending} FROM ${workspaces}, ${memberships}, ${appointments}, ${users}, ${sessions}, ${accounts}, ${verifications}, ${rateLimits}, ${invitations}, ${timeOff}, ${emailOutbox}, ${bookingOperations}, ${chatSessions} LIMIT 0
    `);
    return Response.json(
      { status: "ready", service: "welio", requestId },
      { headers },
    );
  } catch {
    console.error(
      JSON.stringify({ event: "database_readiness_failed", requestId }),
    );
    return Response.json(
      { status: "not_ready", service: "welio", requestId },
      { status: 503, headers },
    );
  }
}
