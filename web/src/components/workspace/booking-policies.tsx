"use client";
import {
  saveBookingPoliciesAction,
  saveReminderPolicyAction,
} from "@/app/dashboard/booking-actions";
import { text } from "@/components/platform/form-utils";
import { Notice } from "@/components/platform/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { policyInput } from "@/lib/domain/bookings/contract";
import { runServerAction } from "@/lib/run-server-action";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useState } from "react";
import { toast } from "sonner";

type Data = WorkspaceDashboardData;
async function save(
  action: typeof saveBookingPoliciesAction,
  workspaceId: string,
  input: unknown,
) {
  const result = await runServerAction(() => action(workspaceId, input));
  if (!result.ok) throw Error(result.error);

  return result;
}

export function BookingPolicies({ data }: { data: Data }) {
  const router = useRouter();
  const w = data.workspace;
  const [savingPolicies, setSavingPolicies] = useState(false);
  const [policyValidationError, setPolicyValidationError] = useState("");
  const [reminderEnabled, setReminderEnabled] = useState(w.remindersEnabled);
  const [savingReminder, setSavingReminder] = useState(false);

  async function submitPolicies(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingPolicies) return;

    setPolicyValidationError("");
    const form = new FormData(event.currentTarget);
    const result = policyInput.safeParse({
      leadHours: text(form, "leadHours"),
      horizonDays: text(form, "horizonDays"),
      cancelHours: text(form, "cancelHours"),
      slotMinutes: text(form, "slotMinutes"),
    });
    if (!result.success) {
      setPolicyValidationError(result.error.issues[0].message);

      return;
    }

    setSavingPolicies(true);
    try {
      await save(saveBookingPoliciesAction, w.id, result.data);
      toast.success("Booking policies saved.");
      router.refresh();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Could not save booking rules.",
      );
    } finally {
      setSavingPolicies(false);
    }
  }

  async function submitReminder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingReminder) return;

    setSavingReminder(true);
    try {
      await save(saveReminderPolicyAction, w.id, { enabled: reminderEnabled });
      toast.success("Reminder settings saved.");
      router.refresh();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not save reminders.",
      );
    } finally {
      setSavingReminder(false);
    }
  }

  return (
    <>
      <section
        className="border-b pb-8"
        aria-labelledby="booking-policy-heading"
      >
        <h3 id="booking-policy-heading" className="font-medium">
          Booking policies
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Rules for new bookings and customer changes. Existing appointment
          times are preserved.
        </p>
        <form onSubmit={submitPolicies} className="mt-6 max-w-2xl">
          <FieldGroup>
            {policyValidationError && (
              <Notice error>{policyValidationError}</Notice>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="booking-lead-hours">
                  Minimum notice (hours)
                </FieldLabel>
                <Input
                  id="booking-lead-hours"
                  name="leadHours"
                  type="number"
                  min={0}
                  max={168}
                  step={1}
                  defaultValue={w.leadHours}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="booking-horizon-days">
                  Booking window (days)
                </FieldLabel>
                <Input
                  id="booking-horizon-days"
                  name="horizonDays"
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  defaultValue={w.horizonDays}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="booking-cancel-hours">
                  Change & cancellation notice (hours)
                </FieldLabel>
                <Input
                  id="booking-cancel-hours"
                  name="cancelHours"
                  type="number"
                  min={0}
                  max={168}
                  step={1}
                  defaultValue={w.cancelHours}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="booking-slot-minutes">
                  Time slot interval
                </FieldLabel>
                <NativeSelect
                  id="booking-slot-minutes"
                  name="slotMinutes"
                  defaultValue={String(w.slotMinutes)}
                  className="w-full"
                >
                  {[15, 30, 60].map((minutes) => (
                    <NativeSelectOption key={minutes} value={String(minutes)}>
                      {minutes} minutes
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Button
              type="submit"
              disabled={savingPolicies}
              className="self-start"
            >
              {savingPolicies ? "Saving…" : "Save booking policies"}
            </Button>
          </FieldGroup>
        </form>
      </section>
      <section className="border-b pb-8" aria-labelledby="reminder-heading">
        <h3 id="reminder-heading" className="font-medium">
          Appointment reminders
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          One email reminder, 24 hours before each eligible appointment.
        </p>
        <form onSubmit={submitReminder} className="mt-6 max-w-2xl">
          <FieldGroup>
            <Field orientation="horizontal">
              <Checkbox
                id="booking-reminders"
                checked={reminderEnabled}
                onCheckedChange={setReminderEnabled}
              />
              <FieldContent>
                <FieldLabel htmlFor="booking-reminders">
                  Send appointment reminders
                </FieldLabel>
                <FieldDescription>
                  Only confirmed bookings with email consent receive reminders.
                  Bookings made less than 24 hours ahead receive a confirmation
                  without a separate reminder. Turning this off skips queued
                  reminders.
                </FieldDescription>
              </FieldContent>
            </Field>
            <Button
              type="submit"
              disabled={savingReminder}
              className="self-start"
            >
              {savingReminder ? "Saving…" : "Save reminder settings"}
            </Button>
          </FieldGroup>
        </form>
      </section>
    </>
  );
}
