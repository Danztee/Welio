"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDatabase } from "@welio/db";
import { requireUser } from "@/lib/auth/session";
import { BookingError } from "@welio/domain/bookings/errors";
import { WorkspaceError } from "@welio/domain/workspaces/errors";
import { saveReceptionistConfiguration } from "@welio/db/receptionist/configuration";
import { ReceptionistError } from "@welio/domain/receptionist/contract";
import { receptionistSettingsSchema } from "@welio/domain/receptionist/settings";

function failure(error: unknown, fallback: string) {
  if (error instanceof z.ZodError)
    return error.issues[0]?.message ?? "Check the form fields.";

  if (
    error instanceof WorkspaceError ||
    error instanceof BookingError ||
    error instanceof ReceptionistError
  )
    return error.message;

  return fallback;
}

export async function saveReceptionistAction(
  workspaceId: string,
  input: unknown,
) {
  const user = await requireUser();
  try {
    const id = z.uuid().parse(workspaceId);
    await saveReceptionistConfiguration(
      getDatabase(),
      user.id,
      id,
      receptionistSettingsSchema.parse(input),
    );
    revalidatePath("/dashboard", "layout");

    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: failure(error, "Could not save receptionist settings. Try again."),
    };
  }
}
