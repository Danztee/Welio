"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { receptionistSettingsSchema } from "@/lib/domain/receptionist/settings";
import { backendRequest, BackendError } from "@/lib/backend/server-api";

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
    await backendRequest(`/v1/workspaces/${id}/receptionist`, {
      method: "PUT",
      workspaceId: id,
      body: receptionistSettingsSchema.parse(input),
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
