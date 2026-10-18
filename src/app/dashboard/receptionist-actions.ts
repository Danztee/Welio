"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { MessageData } from "@strands-agents/sdk";
import { getDatabase } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { appOrigin, rateLimit } from "@/lib/bookings/http";
import { BookingError, getCatalog } from "@/lib/bookings/repository";
import { WorkspaceError } from "@/lib/workspaces/repository";
import {
  aiConfigured,
  receptionistModel,
  dailyModelCallLimit,
} from "@/lib/receptionist/provider";
import { saveReceptionistConfiguration } from "@/lib/receptionist/configuration";
import { ReceptionistError } from "@/lib/receptionist/contract";
import { runReceptionist } from "@/lib/receptionist/gateway";
import { reserveModelCall } from "@/lib/receptionist/repository";

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
    z.uuid().parse(workspaceId);
    await saveReceptionistConfiguration(
      getDatabase(),
      user.id,
      workspaceId,
      input,
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
const previewInput = z.strictObject({
  text: z.string().trim().min(1).max(1600),
  turns: z
    .array(
      z.strictObject({
        text: z.string().max(1600),
        reply: z.string().max(4000),
      }),
    )
    .max(5),
});
export async function previewReceptionistAction(
  workspaceId: string,
  input: unknown,
) {
  const user = await requireUser();
  try {
    z.uuid().parse(workspaceId);
    const value = previewInput.parse(input);
    const db = getDatabase();
    const scope = { userId: user.id, workspaceId };
    const catalog = await getCatalog(db, scope);
    if (!aiConfigured())
      throw new ReceptionistError(
        "The receptionist is temporarily unavailable. Please try again later.",
        503,
      );
    await rateLimit(
      new Request(appOrigin(), { headers: await headers() }),
      `receptionist-preview:${user.id}`,
      20,
      3600,
    );
    const limit = dailyModelCallLimit();
    const messages: MessageData[] = value.turns.flatMap(
      (turn): MessageData[] => [
        { role: "user", content: [{ text: turn.text }] },
        { role: "assistant", content: [{ text: turn.reply }] },
      ],
    );
    messages.push({ role: "user", content: [{ text: value.text }] });
    const result = await runReceptionist({
      db,
      slug: catalog.slug,
      messages,
      model: receptionistModel(),
      reserve: () => reserveModelCall(db, limit),
      preview: scope,
    });
    // Preview can propose bookings but never commits or sends confirmation.
    return {
      ok: true as const,
      reply: result.pending
        ? "Preview booking prepared. In the live chat, the customer would review this card and explicitly confirm it."
        : result.reply,
      proposal: result.pending,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: failure(
        error,
        "The receptionist could not respond. Please try again shortly.",
      ),
    };
  }
}
