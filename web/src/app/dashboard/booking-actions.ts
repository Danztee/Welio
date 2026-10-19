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
import { backendRequest, BackendError } from "@/lib/backend/server-api";

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
        error: error.issues[0]?.message ?? "Check the form fields.",
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
    const result = await backendRequest<{ id: string }>(
      `/v1/workspaces/${id}/appointments`,
      { method: "POST", workspaceId: id, body: booking },
    );

    return result.id;
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
    const result = await backendRequest<{ id: string }>(
      `/v1/workspaces/${id}/appointments/${request.id}`,
      { method: "POST", workspaceId: id, body: request.change },
    );

    return result.id;
  });
}

export async function saveBookingPoliciesAction(
  workspaceId: string,
  input: unknown,
) {
  return completeBookingMutation("policies", workspaceId, async (id) => {
    const policy = policyInput.parse(input);
    await backendRequest<void>(`/v1/workspaces/${id}/booking-policy`, {
      method: "PUT",
      workspaceId: id,
      body: policy,
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
    await backendRequest<void>(`/v1/workspaces/${id}/reminder-policy`, {
      method: "PUT",
      workspaceId: id,
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
    await backendRequest<void>(`/v1/workspaces/${id}/booking-page`, {
      method: "PUT",
      workspaceId: id,
      body: { published },
    });

    return id;
  });
}

export async function saveTimeOffAction(workspaceId: string, input: unknown) {
  return completeBookingMutation("timeOff", workspaceId, async (id) => {
    const timeOff = timeOffInput.parse(input);
    const result = await backendRequest<{ id: string }>(
      `/v1/workspaces/${id}/time-off`,
      { method: "POST", workspaceId: id, body: timeOff },
    );

    return result.id;
  });
}

export async function removeTimeOffAction(workspaceId: string, input: unknown) {
  return completeBookingMutation("removeTimeOff", workspaceId, async (id) => {
    const timeOffId = z.uuid().parse(input);
    await backendRequest<void>(`/v1/workspaces/${id}/time-off/${timeOffId}`, {
      method: "DELETE",
      workspaceId: id,
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
      await backendRequest<void>(
        `/v1/workspaces/${id}/notifications/${notificationId}/retry`,
        { method: "POST", workspaceId: id, body: {} },
      );

      return id;
    },
  );
}
