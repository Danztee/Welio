"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDatabase } from "@welio/db";
import {
  changeBooking,
  createBooking,
  getBooking,
  publishBooking,
  removeTimeOff,
  savePolicies,
  saveTimeOff,
} from "@welio/db/bookings";
import { retryEmail } from "@welio/db/bookings/outbox";
import { saveReminderPolicy } from "@welio/db/bookings/reminders";
import {
  bookingInput,
  changeInput,
  policyInput,
  timeOffInput,
} from "@welio/domain/bookings/contract";
import { BookingError } from "@welio/domain/bookings/errors";
import { WorkspaceError } from "@welio/domain/workspaces/errors";
import { requireUser } from "@/lib/auth/session";
import { appOrigin } from "@/lib/bookings/http";
import { dispatchEmail } from "@/lib/bookings/dispatch";

type ActionResult = { ok: true; id: string } | { ok: false; error: string };

async function completeBookingMutation(
  action: string,
  workspaceId: string,
  operation: (userId: string, workspaceId: string) => Promise<string>,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const id = z.uuid().parse(workspaceId);
    const resultId = await operation(user.id, id);
    dispatchEmail(id);
    revalidatePath("/dashboard", "layout");
    revalidatePath("/book/[slug]", "page");

    return { ok: true, id: resultId };
  } catch (error) {
    if (error instanceof z.ZodError)
      return {
        ok: false,
        error: error.issues[0]?.message ?? "Check the form fields.",
      };

    if (error instanceof BookingError || error instanceof WorkspaceError)
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
  return completeBookingMutation("book", workspaceId, async (userId, id) => {
    const result = await createBooking(
      getDatabase(),
      { userId, workspaceId: id },
      bookingInput.parse(input),
      appOrigin(),
    );

    return result.id;
  });
}

export async function changeWorkspaceBookingAction(
  workspaceId: string,
  input: unknown,
) {
  return completeBookingMutation("change", workspaceId, async (userId, id) => {
    const request = z
      .object({ id: z.uuid(), change: changeInput })
      .parse(input);
    const db = getDatabase();
    const current = await getBooking(db, request.id, { userId });
    if (current.workspaceId !== id)
      throw new BookingError("Booking unavailable.", "not_found");

    const changed = await changeBooking(
      db,
      request.id,
      { userId },
      request.change,
      appOrigin(),
    );

    return changed.id;
  });
}

export async function saveBookingPoliciesAction(
  workspaceId: string,
  input: unknown,
) {
  return completeBookingMutation(
    "policies",
    workspaceId,
    async (userId, id) => {
      await savePolicies(getDatabase(), userId, id, policyInput.parse(input));

      return id;
    },
  );
}

export async function saveReminderPolicyAction(
  workspaceId: string,
  input: unknown,
) {
  return completeBookingMutation(
    "reminders",
    workspaceId,
    async (userId, id) => {
      await saveReminderPolicy(
        getDatabase(),
        userId,
        id,
        z.object({ enabled: z.boolean() }).parse(input),
      );

      return id;
    },
  );
}

export async function setBookingPublishedAction(
  workspaceId: string,
  input: unknown,
) {
  return completeBookingMutation("publish", workspaceId, async (userId, id) => {
    await publishBooking(getDatabase(), userId, id, z.boolean().parse(input));

    return id;
  });
}

export async function saveTimeOffAction(workspaceId: string, input: unknown) {
  return completeBookingMutation("timeOff", workspaceId, async (userId, id) => {
    await saveTimeOff(getDatabase(), userId, id, timeOffInput.parse(input));

    return id;
  });
}

export async function removeTimeOffAction(workspaceId: string, input: unknown) {
  return completeBookingMutation(
    "removeTimeOff",
    workspaceId,
    async (userId, id) => {
      await removeTimeOff(getDatabase(), userId, id, z.uuid().parse(input));

      return id;
    },
  );
}

export async function retryBookingEmailAction(
  workspaceId: string,
  input: unknown,
) {
  return completeBookingMutation(
    "retryEmail",
    workspaceId,
    async (userId, id) => {
      await retryEmail(getDatabase(), userId, id, z.uuid().parse(input));

      return id;
    },
  );
}
