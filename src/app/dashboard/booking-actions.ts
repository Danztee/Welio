"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getDatabase } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { appOrigin } from "@/lib/bookings/http";
import {
  createBooking,
  getBooking,
  changeBooking,
  savePolicies,
  publishBooking,
  saveTimeOff,
  removeTimeOff,
  BookingError,
} from "@/lib/bookings/repository";
import { WorkspaceError } from "@/lib/workspaces/repository";
import { retryEmail } from "@/lib/bookings/outbox";
import { dispatchEmail } from "@/lib/bookings/dispatch";
import { saveReminderPolicy } from "@/lib/bookings/reminders";
export async function bookingAction(
  action: string,
  workspaceId: string,
  input: unknown,
) {
  const user = await requireUser();
  try {
    z.uuid().parse(workspaceId);
    const db = getDatabase();
    let id = workspaceId;
    switch (action) {
      case "book":
        id = (
          await createBooking(
            db,
            { userId: user.id, workspaceId },
            input,
            appOrigin(),
          )
        ).id;
        break;
      case "change": {
        const v = z.object({ id: z.uuid(), change: z.unknown() }).parse(input);
        const current = await getBooking(db, v.id, { userId: user.id });
        if (current.workspaceId !== workspaceId)
          throw new BookingError("Booking unavailable.", 404);
        id = (
          await changeBooking(
            db,
            v.id,
            { userId: user.id },
            v.change,
            appOrigin(),
          )
        ).id;
        break;
      }
      case "policies":
        await savePolicies(db, user.id, workspaceId, input);
        break;
      case "reminders":
        await saveReminderPolicy(db, user.id, workspaceId, input);
        break;
      case "publish":
        await publishBooking(
          db,
          user.id,
          workspaceId,
          z.boolean().parse(input),
        );
        break;
      case "timeOff":
        await saveTimeOff(db, user.id, workspaceId, input);
        break;
      case "removeTimeOff":
        await removeTimeOff(db, user.id, workspaceId, z.uuid().parse(input));
        break;
      case "retryEmail":
        await retryEmail(db, user.id, workspaceId, z.uuid().parse(input));
        break;
      default:
        throw new BookingError("Unknown operation.", 400);
    }
    dispatchEmail(workspaceId);
    revalidatePath("/dashboard", "layout");
    revalidatePath("/book/[slug]", "page");
    return { ok: true as const, id };
  } catch (e) {
    if (e instanceof z.ZodError)
      return {
        ok: false as const,
        error: e.issues[0]?.message ?? "Check the form fields.",
      };
    if (e instanceof BookingError || e instanceof WorkspaceError)
      return { ok: false as const, error: e.message };
    return {
      ok: false as const,
      error: "Could not save this change. Please reload and try again.",
    };
  }
}
