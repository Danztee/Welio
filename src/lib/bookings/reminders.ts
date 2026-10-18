import { and, eq, gt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db/connection";
import { appointments, workspaces, emailOutbox } from "@/db/schema";
import { authorizeWorkspace } from "@/lib/workspaces/repository";

export const reminderPolicyInput = z.strictObject({ enabled: z.boolean() });
const day = 24 * 60 * 60_000;
type Appointment = typeof appointments.$inferSelect;
type Workspace = typeof workspaces.$inferSelect;
export const reminderKey = (a: Pick<Appointment, "id" | "version">) =>
  `${a.id}:reminder:${a.version}`;
export function reminderApplies(a: Appointment, w: Workspace, now: Date) {
  return (
    w.remindersEnabled &&
    a.notificationConsent &&
    a.status === "confirmed" &&
    a.startsAt > now &&
    a.startsAt.getTime() <= now.getTime() + day &&
    a.createdAt.getTime() <= a.startsAt.getTime() - day &&
    Boolean(a.customerEmail)
  );
}
export async function saveReminderPolicy(
  db: Database,
  userId: string,
  workspaceId: string,
  input: unknown,
  now = new Date(),
) {
  const value = reminderPolicyInput.parse(input);
  await db.transaction(async (tx) => {
    await authorizeWorkspace(tx, userId, workspaceId, true);
    await tx
      .update(workspaces)
      .set({ remindersEnabled: value.enabled })
      .where(eq(workspaces.id, workspaceId));
    if (!value.enabled)
      await tx
        .update(emailOutbox)
        .set({ status: "skipped" })
        .where(
          and(
            eq(emailOutbox.workspaceId, workspaceId),
            eq(emailOutbox.kind, "reminder"),
            sql`${emailOutbox.status} in ('queued','failed')`,
          ),
        );
    else
      await tx
        .update(emailOutbox)
        .set({ status: "queued" })
        .where(
          and(
            eq(emailOutbox.workspaceId, workspaceId),
            eq(emailOutbox.kind, "reminder"),
            eq(emailOutbox.status, "skipped"),
            eq(emailOutbox.attempts, 0),
            sql`exists (select 1 from ${appointments} where ${appointments.workspaceId} = ${emailOutbox.workspaceId} and ${appointments.id} = ${emailOutbox.appointmentId} and ${appointments.version} = ${emailOutbox.appointmentVersion} and ${appointments.customerEmail} = ${emailOutbox.recipient} and ${appointments.status} = 'confirmed' and ${appointments.notificationConsent} = true and ${appointments.startsAt} > ${now} and ${appointments.startsAt} <= ${new Date(now.getTime() + day)} and ${appointments.createdAt} <= ${appointments.startsAt} - interval '24 hours')`,
          ),
        );
  });
}
function reminderMail(a: Appointment, w: Workspace) {
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: a.timeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(a.startsAt);
  const price = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: a.currency,
  }).format(a.priceMinor / 100);
  return {
    subject: `Appointment reminder · ${w.name}`,
    body: `Your upcoming appointment\n\n${a.serviceName}\n${when} (${a.timeZone})\n${price}\nAddress: ${a.serviceAddress ?? ""}\n\nChanges and cancellations require ${w.cancelHours} hours’ notice. Use the private management link in your original confirmation email to manage this booking.\n\nContact: ${w.contactEmail || w.phone}\nReference: ${a.id}`,
  };
}
export async function enqueueDueReminders(
  db: Database,
  now = new Date(),
  limit = 50,
  workspaceId?: string,
) {
  z.number().int().min(1).max(100).parse(limit);
  const candidates = await db
    .select({ id: appointments.id, workspaceId: appointments.workspaceId })
    .from(appointments)
    .innerJoin(workspaces, eq(workspaces.id, appointments.workspaceId))
    .where(
      and(
        eq(workspaces.remindersEnabled, true),
        eq(appointments.notificationConsent, true),
        eq(appointments.status, "confirmed"),
        gt(appointments.startsAt, now),
        lte(appointments.startsAt, new Date(now.getTime() + day)),
        sql`${appointments.createdAt} <= ${appointments.startsAt} - interval '24 hours'`,
        sql`not exists (select 1 from ${emailOutbox} where ${emailOutbox.eventKey} = ${appointments.id}::text || ':reminder:' || ${appointments.version}::text)`,
        ...(workspaceId ? [eq(appointments.workspaceId, workspaceId)] : []),
      ),
    )
    .orderBy(appointments.startsAt, appointments.id)
    .limit(limit);
  let queued = 0;
  const deadline = Date.now() + 3000;
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    queued += await db.transaction(async (tx) => {
      // Match booking writers' workspace-first lock order to avoid deadlocks.
      const [w] = await tx
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, candidate.workspaceId))
        .for("update", { skipLocked: true });
      if (!w) return 0;
      const [a] = await tx
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.id, candidate.id),
            eq(appointments.workspaceId, w.id),
          ),
        )
        .for("update");
      if (!a || !reminderApplies(a, w, now)) return 0;
      const added = await tx
        .insert(emailOutbox)
        .values({
          workspaceId: w.id,
          appointmentId: a.id,
          eventKey: reminderKey(a),
          recipient: a.customerEmail,
          ...reminderMail(a, w),
          kind: "reminder",
          appointmentVersion: a.version,
        })
        .onConflictDoNothing()
        .returning({ id: emailOutbox.id });
      return added.length;
    });
  }
  return { queued };
}
