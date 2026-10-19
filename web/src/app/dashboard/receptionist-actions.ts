"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { receptionistSettingsSchema } from "@/lib/domain/receptionist/settings";
import { backendClient, BackendError } from "@/lib/backend/server-api";

import { workspaceReceptionistSettingsUpdate } from "@/lib/backend/generated/sdk.gen";

function failure(error: unknown, fallback: string) {
  if (error instanceof z.ZodError)
    return error.issues[0]?.message ?? "Check the form fields.";

  if (error instanceof BackendError) return error.message;

  return fallback;
}

export async function saveReceptionistAction(
  workspaceId: string,
  input: unknown,
) {
  await requireUser();
  try {
    const id = z.uuid().parse(workspaceId);
    const settings = receptionistSettingsSchema.parse(input);
    await workspaceReceptionistSettingsUpdate({
      client: await backendClient(id),
      throwOnError: true,
      path: { workspaceID: id },
      body: {
        enabled: settings.enabled,
        greeting: settings.greeting,
        instructions: settings.instructions,
        faqs: settings.faqs,
        allow_availability: settings.allowAvailability,
        allow_booking: settings.allowBooking,
      },
    });
    revalidatePath("/dashboard", "layout");

    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: failure(error, "Could not save receptionist settings. Try again."),
    };
  }
}
