import { loadReceptionistConfiguration } from "@welio/db/receptionist/configuration";
import { getDatabase } from "@welio/db";
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
  chatSessionLifetimeMs,
  slugInput,
  ReceptionistError,
} from "@welio/domain/receptionist/contract";
import { receptionistStreamResponse } from "@/lib/receptionist/stream-response";
import { receptionistStatus } from "@/lib/receptionist/errors";
import type { NextRequest } from "next/server";
import {
  startChat,
  chatState,
  listChatSessions,
  messageChat,
  confirmProposal,
  rejectProposal,
  reserveModelCall,
} from "@/lib/receptionist/repository";

export const runtime = "nodejs";

export const maxDuration = 60;

const legacyChatCookieName = "welio-chat-session";
const cookiePrefix = "welio-chat-";

function conversationCookieName(id: string) {
  return `${cookiePrefix}${id}`;
}

function chatCookies(
  request: NextRequest,
): { id: string | null; token: string }[] {
  const result: { id: string | null; token: string }[] = [];
  for (const { name, value } of request.cookies.getAll()) {
    if (name === legacyChatCookieName) {
      result.push({ id: null, token: value });
      continue;
    }

    if (!name.startsWith(cookiePrefix)) continue;

    const id = name.slice(cookiePrefix.length);
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    )
      result.push({ id, token: value });
  }

  return result;
}

function chatToken(request: NextRequest, conversationId: string) {
  const token = request.cookies.get(
    conversationCookieName(conversationId),
  )?.value;
  if (!token)
    throw new ReceptionistError(
      "This chat session has expired. Start a new conversation.",
      "not_found",
    );

  return token;
}

function setChatCookie(
  response: Response,
  slug: string,
  id: string,
  token: string,
) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.append(
    "Set-Cookie",
    `${conversationCookieName(id)}=${token}; Max-Age=${Math.floor(chatSessionLifetimeMs / 1000)}; Path=/api/chat/${slug}; HttpOnly; SameSite=Lax${secure}`,
  );

  return response;
}

function clearLegacyCookie(response: Response, slug: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.append(
    "Set-Cookie",
    `${legacyChatCookieName}=; Max-Age=0; Path=/api/chat/${slug}; HttpOnly; SameSite=Lax${secure}`,
  );

  return response;
}

function publicConversations(
  sessions: Awaited<ReturnType<typeof listChatSessions>>,
) {
  return sessions.map(({ id, title, preview, updatedAt }) => ({
    id,
    title,
    preview,
    updatedAt,
  }));
}

export async function POST(
  request: NextRequest,
  { params }: RouteContext<"/api/chat/[slug]">,
) {
  try {
    requireOrigin(request);
    const slug = slugInput.parse((await params).slug);
    const input = chatRequest.parse(await readBody(request));
    await rateLimit(request, "chat-requests", 120, 3600);
    const db = getDatabase();

    if (
      input.action === "start" ||
      input.action === "new" ||
      input.action === "message"
    ) {
      const settings = await loadReceptionistConfiguration(db, slug);
      if (!settings.enabled)
        throw new ReceptionistError(
          "The receptionist is paused. Please use the booking form.",
          "unavailable",
        );
    }

    if (input.action === "list") {
      const sessions = await listChatSessions(db, slug, chatCookies(request));

      return bookingResponse(publicConversations(sessions));
    }

    if (input.action === "start") {
      const existingCookies = chatCookies(request);
      const sessions = await listChatSessions(db, slug, existingCookies);
      if (sessions.length) {
        const selected =
          sessions.find((session) => session.id === input.conversationId) ??
          sessions[0];
        const response = bookingResponse({
          conversationId: selected.id,
          state: await chatState(db, slug, selected.token),
          conversations: publicConversations(sessions),
        });
        const hasDedicatedCookie = existingCookies.some(
          (cookie) => cookie.id === selected.id,
        );
        if (hasDedicatedCookie) return response;

        setChatCookie(response, slug, selected.id, selected.token);

        return clearLegacyCookie(response, slug);
      }

      if (!aiConfigured())
        throw new ReceptionistError(
          "The AI receptionist is not available yet. Please use the booking form.",
          "unavailable",
        );

      await rateLimit(request, "chat-start", 10, 3600);
      const session = await startChat(db, slug);
      const sessionsWithNew = await listChatSessions(db, slug, [
        ...existingCookies,
        { id: session.id, token: session.token },
      ]);
      const response = bookingResponse(
        {
          conversationId: session.id,
          state: session.state,
          conversations: publicConversations(sessionsWithNew),
        },
        201,
      );

      return setChatCookie(response, slug, session.id, session.token);
    }

    if (input.action === "new") {
      if (!aiConfigured())
        throw new ReceptionistError(
          "The AI receptionist is not available yet. Please use the booking form.",
          "unavailable",
        );

      await rateLimit(request, "chat-start", 10, 3600);
      const session = await startChat(db, slug);
      const sessions = await listChatSessions(db, slug, [
        ...chatCookies(request),
        { id: session.id, token: session.token },
      ]);
      const response = bookingResponse({
        conversationId: session.id,
        state: session.state,
        conversations: publicConversations(sessions),
      });

      return setChatCookie(response, slug, session.id, session.token);
    }

    if (input.action === "open")
      return bookingResponse({
        conversationId: input.conversationId,
        state: await chatState(
          db,
          slug,
          chatToken(request, input.conversationId),
        ),
      });

    if (input.action === "message") {
      await rateLimit(request, "chat-turn", 30, 3600);
      const model = receptionistModel();
      const configuredLimit = dailyModelCallLimit();
      const token = chatToken(request, input.conversationId);

      return receptionistStreamResponse(
        request.signal,
        async ({ signal, onTextDelta, onActivity }) => {
          try {
            return await messageChat(
              db,
              slug,
              token,
              input.key,
              input.text,
              model,
              () => reserveModelCall(db, configuredLimit),
              undefined,
              { signal, onTextDelta, onActivity },
            );
          } catch (error) {
            if (error instanceof ReceptionistError) throw error;

            console.error(
              JSON.stringify({ event: "receptionist_model_or_gateway_failed" }),
            );
            throw new ReceptionistError(
              "The receptionist could not respond. Please retry or use the booking form.",
              "unavailable",
            );
          }
        },
        {
          eventName: "receptionist_model_or_gateway_failed",
          fallbackError:
            "The receptionist could not respond. Please retry or use the booking form.",
        },
      );
    }

    if (input.action === "confirm") {
      await rateLimit(request, "chat-confirm", 8, 3600);
      const state = await confirmProposal(
        db,
        slug,
        chatToken(request, input.conversationId),
        input.proposalId,
        appOrigin(),
      );
      dispatchEmail();

      return bookingResponse(state);
    }

    if (input.action === "reject")
      return bookingResponse(
        await rejectProposal(
          db,
          slug,
          chatToken(request, input.conversationId),
          input.proposalId,
        ),
      );

    return bookingResponse(
      await chatState(db, slug, chatToken(request, input.conversationId)),
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
