import { loadReceptionistConfiguration } from "@/lib/receptionist/configuration";
import { getDatabase } from "@/db";
import {
  appOrigin,
  requireOrigin,
  readBody,
  rateLimit,
  bookingResponse,
  bookingFailure,
} from "@/lib/bookings/http";
import { dispatchEmail } from "@/lib/bookings/dispatch";
import {
  aiConfigured,
  receptionistModel,
  dailyModelCallLimit,
} from "@/lib/receptionist/provider";
import {
  chatRequest,
  slugInput,
  ReceptionistError,
} from "@/lib/receptionist/contract";
import {
  startChat,
  chatState,
  messageChat,
  confirmProposal,
  rejectProposal,
  reserveModelCall,
} from "@/lib/receptionist/repository";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/chat/[slug]">,
) {
  try {
    requireOrigin(request);
    const slug = slugInput.parse((await params).slug);
    const input = chatRequest.parse(await readBody(request));
    await rateLimit(request, "chat-requests", 120, 3600);
    const db = getDatabase();
    if (input.action === "start" || input.action === "message") {
      const settings = await loadReceptionistConfiguration(db, slug);
      if (!settings.enabled)
        throw new ReceptionistError(
          "The receptionist is paused. Please use the booking form.",
          503,
        );
    }
    if (input.action === "start") {
      if (!aiConfigured())
        throw new ReceptionistError(
          "The AI receptionist is not available yet. Please use the booking form.",
          503,
        );
      await rateLimit(request, "chat-start", 10, 3600);
      return bookingResponse(await startChat(db, slug), 201);
    }
    if (input.action === "message") {
      await rateLimit(request, "chat-turn", 30, 3600);
      const model = receptionistModel();
      const configuredLimit = dailyModelCallLimit();
      try {
        return bookingResponse(
          await messageChat(
            db,
            slug,
            input.token,
            input.key,
            input.text,
            model,
            () => reserveModelCall(db, configuredLimit),
          ),
        );
      } catch (error) {
        if (error instanceof ReceptionistError) throw error;
        console.error(
          JSON.stringify({ event: "receptionist_model_or_gateway_failed" }),
        );
        throw new ReceptionistError(
          "The receptionist could not respond. Please retry or use the booking form.",
          503,
        );
      }
    }
    if (input.action === "confirm") {
      await rateLimit(request, "chat-confirm", 8, 3600);
      const state = await confirmProposal(
        db,
        slug,
        input.token,
        input.proposalId,
        appOrigin(),
      );
      dispatchEmail();
      return bookingResponse(state);
    }
    if (input.action === "reject")
      return bookingResponse(
        await rejectProposal(db, slug, input.token, input.proposalId),
      );
    return bookingResponse(await chatState(db, slug, input.token));
  } catch (error) {
    if (error instanceof ReceptionistError)
      return bookingResponse({ error: error.message }, error.status);
    return bookingFailure(error);
  }
}
