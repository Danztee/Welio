"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  bookingInput,
  changeInput,
  policyInput,
  timeOffInput,
} from "@/lib/domain/bookings/contract";
import { requireUser } from "@/lib/auth/session";
import { backendClient, BackendError } from "@/lib/backend/server-api";

import {
  workspaceAppointmentCreate,
  workspaceAppointmentChange,
  workspaceBookingPolicySave,
  workspaceReminderPolicySave,
  workspaceBookingPublish,
  workspaceTimeOffCreate,
  workspaceTimeOffDelete,
  workspaceNotificationRetry,
} from "@/lib/backend/generated/sdk.gen";

type ActionResult = { ok: true; id: string } | { ok: false; error: string };

async function completeBookingMutation(
  action: string,
  workspaceId: string,
  operation: (workspaceId: string) => Promise<string>,
): Promise<ActionResult> {
  await requireUser();
  try {
    const id = z.uuid().parse(workspaceId);
    const resultId = await operation(id);
    revalidatePath("/dashboard", "layout");
    revalidatePath("/book/[slug]", "page");

    return { ok: true, id: resultId };
  } catch (error) {
    if (error instanceof z.ZodError)
      return {
        ok: false,
        error: error.issues[0].message,
      };

    if (error instanceof BackendError)
      return { ok: false, error: error.message };

    console.error(
      JSON.stringify({ event: "booking_operation_failed", action }),
    );

    return {
      ok: false,
      error: "Could not save this change. Please reload and try again.",
    };
  }
}

export async function createWorkspaceBookingAction(
  workspaceId: string,
  input: unknown,
) {
  return completeBookingMutation("book", workspaceId, async (id) => {
    const booking = bookingInput.parse(input);
    const result = await workspaceAppointmentCreate({
      client: await backendClient(id),
      throwOnError: true,
      path: { workspaceId: id },
      body: {
        key: booking.key,
        service_id: booking.serviceId,
        staff_id: booking.staffId,
        date: booking.date,
        time: booking.time,
        service_location: booking.serviceLocation,
        quote: booking.quote,
        name: booking.name,
        email: booking.email,
        phone: booking.phone,
        address: booking.address,
        consent: booking.consent,
      },
    });

    return result.data.id;
  });
}

export async function changeWorkspaceBookingAction(
  workspaceId: string,
  input: unknown,
) {
  return completeBookingMutation("change", workspaceId, async (id) => {
    const request = z
      .object({ id: z.uuid(), change: changeInput })
      .parse(input);
    const result = await workspaceAppointmentChange({
      client: await backendClient(id),
      throwOnError: true,
      path: { workspaceId: id, appointmentId: request.id },
      body: {
        key: request.change.key,
        version: request.change.version,
        action: request.change.action,
        date: request.change.date,
        time: request.change.time,
        staff_id: request.change.staffId,
      },
    });

    return result.data.id;
  });
}

export async function saveBookingPoliciesAction(
  workspaceId: string,
  input: unknown,
) {
  return completeBookingMutation("policies", workspaceId, async (id) => {
    const policy = policyInput.parse(input);
    await workspaceBookingPolicySave({
      client: await backendClient(id),
      throwOnError: true,
      path: { workspaceId: id },
      body: {
        lead_hours: policy.leadHours,
        horizon_days: policy.horizonDays,
        cancel_hours: policy.cancelHours,
        slot_minutes: policy.slotMinutes,
      },
    });

    return id;
  });
}

export async function saveReminderPolicyAction(
  workspaceId: string,
  input: unknown,
) {
  return completeBookingMutation("reminders", workspaceId, async (id) => {
    const reminder = z.object({ enabled: z.boolean() }).parse(input);
    await workspaceReminderPolicySave({
      client: await backendClient(id),
      throwOnError: true,
      path: { workspaceId: id },
      body: reminder,
    });

    return id;
  });
}

export async function setBookingPublishedAction(
  workspaceId: string,
  input: unknown,
) {
  return completeBookingMutation("publish", workspaceId, async (id) => {
    const published = z.boolean().parse(input);
    await workspaceBookingPublish({
      client: await backendClient(id),
      throwOnError: true,
      path: { workspaceId: id },
      body: { published },
    });

    return id;
  });
}

export async function saveTimeOffAction(workspaceId: string, input: unknown) {
  return completeBookingMutation("timeOff", workspaceId, async (id) => {
    const timeOff = timeOffInput.parse(input);
    const result = await workspaceTimeOffCreate({
      client: await backendClient(id),
      throwOnError: true,
      path: { workspaceId: id },
      body: {
        staff_id: timeOff.staffId,
        from: timeOff.from,
        to: timeOff.to,
        reason: timeOff.reason,
      },
    });

    return result.data.id;
  });
}

export async function removeTimeOffAction(workspaceId: string, input: unknown) {
  return completeBookingMutation("removeTimeOff", workspaceId, async (id) => {
    const timeOffId = z.uuid().parse(input);
    await workspaceTimeOffDelete({
      client: await backendClient(id),
      throwOnError: true,
      path: { workspaceId: id, timeOffId },
    });

    return id;
  });
}

export async function retryBookingEmailAction(
  workspaceId: string,
  input: unknown,
) {
  return completeBookingMutation(
    "retryNotification",
    workspaceId,
    async (id) => {
      const notificationId = z
        .string()
        .regex(/^[1-9]\d{0,18}$/)
        .parse(input);
      const jobId = z
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .parse(Number(notificationId));
      await workspaceNotificationRetry({
        client: await backendClient(id),
        throwOnError: true,
        path: { workspaceId: id, notificationId: jobId },
      });

      return id;
    },
  );
}
