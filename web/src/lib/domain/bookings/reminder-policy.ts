import { z } from "zod";

export const reminderPolicyInput = z.strictObject({ enabled: z.boolean() });

export type ReminderPolicy = z.infer<typeof reminderPolicyInput>;

const day = 24 * 60 * 60_000;

type ReminderAppointment = {
  id: string;
  version: number;
  notificationConsent: boolean;
  status: string;
  startsAt: Date;
  createdAt: Date;
  customerEmail: string | null;
};

type ReminderWorkspace = { remindersEnabled: boolean };

export const reminderKey = (
  appointment: Pick<ReminderAppointment, "id" | "version">,
) => `${appointment.id}:reminder:${appointment.version}`;

export function reminderApplies(
  appointment: ReminderAppointment,
  workspace: ReminderWorkspace,
  now: Date,
) {
  return (
    workspace.remindersEnabled &&
    appointment.notificationConsent &&
    appointment.status === "confirmed" &&
    appointment.startsAt > now &&
    appointment.startsAt.getTime() <= now.getTime() + day &&
    appointment.createdAt.getTime() <= appointment.startsAt.getTime() - day &&
    Boolean(appointment.customerEmail)
  );
}
