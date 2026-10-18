import { z } from "zod";
import { getDatabase } from "@welio/db";
import { currentUser } from "@/lib/auth/session";
import {
  bookingFailure,
  bookingResponse,
  rateLimit,
  readBody,
  requireOrigin,
} from "@/lib/bookings/http";
import { getCatalog } from "@welio/db/bookings";
import { ReceptionistError } from "@welio/domain/receptionist/contract";
import { receptionistStatus } from "@/lib/receptionist/errors";
import {
  dailyModelCallLimit,
  aiConfigured,
  receptionistModel,
} from "@/lib/receptionist/provider";
import { reserveModelCall } from "@/lib/receptionist/repository";
import { runReceptionist } from "@/lib/receptionist/gateway";
import { receptionistStreamResponse } from "@/lib/receptionist/stream-response";

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

export const runtime = "nodejs";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/workspaces/[id]/receptionist-preview">,
) {
  try {
    requireOrigin(request);
    const user = await currentUser();
    if (!user?.emailVerified)
      return bookingResponse({ error: "Sign in to continue." }, 401);

    const workspaceId = z.uuid().parse((await params).id);
    const input = previewInput.parse(await readBody(request, 32_000));
    const db = getDatabase();
    const scope = { userId: user.id, workspaceId };
    const catalog = await getCatalog(db, scope);
    if (!aiConfigured())
      throw new ReceptionistError(
        "The receptionist is temporarily unavailable. Please try again later.",
        "unavailable",
      );

    await rateLimit(request, `receptionist-preview:${user.id}`, 20, 3600);
    const model = receptionistModel();
    const limit = dailyModelCallLimit();
    const messages = input.turns.flatMap((turn) => [
      { role: "user" as const, content: [{ text: turn.text }] },
      { role: "assistant" as const, content: [{ text: turn.reply }] },
    ]);
    messages.push({ role: "user", content: [{ text: input.text }] });

    return receptionistStreamResponse(
      request.signal,
      async ({ signal, onTextDelta, onActivity }) => {
        const result = await runReceptionist({
          db,
          slug: catalog.slug,
          messages,
          model,
          reserve: () => reserveModelCall(db, limit),
          preview: scope,
          signal,
          onTextDelta,
          onActivity,
        });

        return {
          reply: result.pending
            ? "Preview booking prepared. In the live chat, the customer would review this card and explicitly confirm it."
            : result.reply,
          proposal: result.pending,
        };
      },
      {
        eventName: "receptionist_preview_failed",
        fallbackError:
          "The receptionist could not respond. Please try again shortly.",
      },
    );
  } catch (error) {
    if (error instanceof ReceptionistError)
      return bookingResponse(
        { error: error.message },
        receptionistStatus(error),
      );

    return bookingFailure(error);
  }
}
