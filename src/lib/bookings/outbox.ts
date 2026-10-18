import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/connection";
import { emailOutbox, workspaces, appointments } from "@/db/schema";
import { reminderApplies } from "./reminders";
import { BookingError } from "./repository";
import { authorizeWorkspace } from "@/lib/workspaces/repository";
import type { AuthMail } from "@/lib/auth/factory";
export async function deliverQueued(
  db: Database,
  send: (mail: AuthMail) => Promise<void>,
  workspaceId?: string,
  limit = 10,
  clock = () => new Date(),
) {
  let sent = 0,
    failed = 0,
    skipped = 0;
  for (let n = 0; n < limit; n++) {
    const claimed = await db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ id: emailOutbox.id, workspace: workspaces })
        .from(emailOutbox)
        .innerJoin(workspaces, eq(workspaces.id, emailOutbox.workspaceId))
        .where(
          and(
            eq(emailOutbox.status, "queued"),
            ...(workspaceId ? [eq(emailOutbox.workspaceId, workspaceId)] : []),
          ),
        )
        .orderBy(emailOutbox.createdAt)
        .limit(1)
        .for("update", { of: workspaces, skipLocked: true });
      if (!candidate) return null;
      const [item] = await tx
        .select()
        .from(emailOutbox)
        .where(
          and(
            eq(emailOutbox.id, candidate.id),
            eq(emailOutbox.status, "queued"),
          ),
        )
        .for("update", { skipLocked: true });
      if (!item) return null;
      if (item.kind === "reminder") {
        const [appointment] = await tx
          .select()
          .from(appointments)
          .where(
            and(
              eq(appointments.workspaceId, item.workspaceId),
              eq(appointments.id, item.appointmentId),
            ),
          )
          .for("update");
        if (
          !appointment ||
          !reminderApplies(appointment, candidate.workspace, clock()) ||
          appointment.version !== item.appointmentVersion ||
          appointment.customerEmail !== item.recipient
        ) {
          await tx
            .update(emailOutbox)
            .set({ status: "skipped" })
            .where(eq(emailOutbox.id, item.id));
          return { skipped: true as const };
        }
      }
      await tx
        .update(emailOutbox)
        .set({
          status: "sending",
          attempts: item.attempts + 1,
          lastAttemptAt: clock(),
        })
        .where(eq(emailOutbox.id, item.id));
      return item;
    });
    if (!claimed) break;
    if ("skipped" in claimed) {
      skipped++;
      continue;
    }
    let accepted = false;
    try {
      await send({
        to: claimed.recipient,
        subject: claimed.subject,
        text: claimed.body,
      });
      accepted = true;
    } catch {
      /* Provider errors may contain private email data. */
    }
    await db
      .update(emailOutbox)
      .set({
        status: accepted ? "sent" : "failed",
        sentAt: accepted ? clock() : null,
      })
      .where(eq(emailOutbox.id, claimed.id));
    if (accepted) sent++;
    else failed++;
  }
  return { sent, failed, skipped };
}
export async function retryEmail(
  db: Database,
  userId: string,
  workspaceId: string,
  id: string,
) {
  await db.transaction(async (tx) => {
    await authorizeWorkspace(tx, userId, workspaceId, true);
    const updated = await tx
      .update(emailOutbox)
      .set({ status: "queued" })
      .where(
        and(
          eq(emailOutbox.workspaceId, workspaceId),
          eq(emailOutbox.id, id),
          sql`(${emailOutbox.status}='failed' or (${emailOutbox.status}='sending' and ${emailOutbox.lastAttemptAt}<now()-interval '10 minutes'))`,
        ),
      )
      .returning({ id: emailOutbox.id });
    if (!updated.length)
      throw new BookingError(
        "This email is already queued or sent, or is still sending. Interrupted sends can be retried after 10 minutes.",
      );
  });
}
