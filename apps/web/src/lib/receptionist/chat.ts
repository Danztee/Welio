import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { Database } from "@welio/db/connection";
import {
  claimChatConfirmation,
  claimChatTurn,
  completeChatConfirmation,
  createChatSession,
  listChatSessionRows,
  loadChatSession,
  rejectChatProposal,
  releaseChatLease,
  reserveModelCall as reserveModelCallInDb,
  saveChatTurn,
  type ChatSession,
} from "@welio/db/receptionist/chat-sessions";
import { createBooking, getCatalog } from "@welio/db/bookings";
import { runReceptionist } from "./gateway";
import type { MessageData, Model } from "@strands-agents/sdk";
import {
  ReceptionistError,
  chatSessionLifetimeMs,
  type ChatState,
  type ChatSummary,
  type ReceptionistActivity,
  type StoredConversationMessage,
} from "@welio/domain/receptionist/contract";

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const toChatState = (session: ChatSession): ChatState => ({
  turns: session.turns,
  pending: session.pending,
  receipt: session.receipt,
  retry: session.activeTurn,
});

function unavailableChat() {
  return new ReceptionistError(
    "This chat has expired or is unavailable. Start a new conversation.",
    "not_found",
  );
}

export async function startChat(db: Database, slug: string, now = new Date()) {
  const catalog = await getCatalog(db, { slug }, now);
  const token = randomBytes(32).toString("base64url");
  const id = await createChatSession(
    db,
    catalog.id,
    token,
    new Date(now.getTime() + chatSessionLifetimeMs),
  );

  return {
    id,
    token,
    state: { turns: [], pending: null, receipt: null, retry: null },
  };
}

export async function listChatSessions(
  db: Database,
  slug: string,
  cookies: { id: string | null; token: string }[],
  now = new Date(),
) {
  if (!cookies.length) return [] as (ChatSummary & { token: string })[];

  const tokenByHash = new Map(
    cookies.map(({ token }) => [hashToken(token), token]),
  );
  const requestedIdByHash = new Map(
    cookies.map(({ id, token }) => [hashToken(token), id]),
  );
  const rows = await listChatSessionRows(db, slug, cookies, now);

  return rows
    .filter((row) => {
      const requestedId = requestedIdByHash.get(row.tokenHash);

      return requestedId === null || requestedId === row.id;
    })
    .map((row) => {
      const firstMessage = row.turns[0]?.text ?? row.activeTurn?.text;
      const lastReply = row.turns.at(-1)?.reply;
      const title = firstMessage ?? row.businessName;
      const preview =
        lastReply ??
        (firstMessage ? "Waiting for a reply…" : "Start a conversation");

      return {
        id: row.id,
        title: title.length > 64 ? `${title.slice(0, 61).trimEnd()}…` : title,
        preview:
          preview.length > 120
            ? `${preview.slice(0, 117).trimEnd()}…`
            : preview,
        updatedAt: row.updatedAt.toISOString(),
        token: tokenByHash.get(row.tokenHash)!,
      };
    });
}

export async function chatState(
  db: Database,
  slug: string,
  token: string,
  now = new Date(),
) {
  const session = await loadChatSession(db, slug, token, now);
  if (!session) throw unavailableChat();

  return toChatState(session);
}

export async function reserveModelCall(
  db: Database,
  max: number,
  now = new Date(),
) {
  const reserved = await reserveModelCallInDb(db, max, now);
  if (!reserved)
    throw new ReceptionistError(
      "The receptionist has reached today's usage limit. Please use the booking form.",
      "rate_limited",
    );
}

export async function messageChat(
  db: Database,
  slug: string,
  token: string,
  key: string,
  text: string,
  model: Model,
  reserve: () => Promise<void>,
  now = () => new Date(),
  stream?: {
    signal: AbortSignal;
    onTextDelta: (text: string) => void;
    onActivity: (activity: ReceptionistActivity) => void;
  },
) {
  const claim = await claimChatTurn(db, {
    slug,
    token,
    key,
    text,
    now: now(),
  });
  if (claim.status === "unavailable") throw unavailableChat();

  if (claim.status === "message-key-reused")
    throw new ReceptionistError(
      "This message key was used for different text.",
    );

  if (claim.status === "retry-previous")
    throw new ReceptionistError(
      "Retry your previous message before sending another one.",
    );

  if (claim.status === "busy")
    throw new ReceptionistError(
      "A request is still in progress. Please wait and retry.",
    );

  if (claim.status === "full")
    throw new ReceptionistError(
      "This conversation is full. Start a new chat or use the booking form.",
      "unprocessable",
    );

  if (claim.status === "cached") return claim.state;

  const session = claim.session;
  try {
    const result = await runReceptionist({
      db,
      slug,
      messages: [
        ...(session.messages as MessageData[]),
        { role: "user", content: [{ text }] },
      ],
      model,
      reserve,
      now,
      ...(stream
        ? {
            signal: stream.signal,
            onTextDelta: stream.onTextDelta,
            onActivity: stream.onActivity,
          }
        : {}),
    });
    const saved = await saveChatTurn(db, {
      sessionId: session.id,
      lease: claim.lease,
      messages: result.messages as StoredConversationMessage[],
      turns: [...session.turns, { key, text, reply: result.reply }],
      activeTurn: null,
      pending: result.pending,
    });
    if (!saved)
      throw new ReceptionistError(
        "This request expired. Please reload the conversation.",
      );

    return toChatState(saved);
  } catch (error) {
    await releaseChatLease(db, session.id, claim.lease);
    throw error;
  }
}

export async function rejectProposal(
  db: Database,
  slug: string,
  token: string,
  proposalId: string,
  now = new Date(),
) {
  const result = await rejectChatProposal(db, {
    slug,
    token,
    proposalId,
    now,
  });
  if (result.status === "unavailable") throw unavailableChat();

  if (result.status === "busy")
    throw new ReceptionistError(
      "A request is still in progress. Please wait and retry.",
    );

  if (result.status === "stale")
    throw new ReceptionistError("That proposal is no longer current.");

  return result.state;
}

export async function confirmProposal(
  db: Database,
  slug: string,
  token: string,
  proposalId: string,
  origin: string,
  now = new Date(),
) {
  const claim = await claimChatConfirmation(db, {
    slug,
    token,
    proposalId,
    now,
  });
  if (claim.status === "unavailable") throw unavailableChat();

  if (claim.status === "busy")
    throw new ReceptionistError(
      "A request is still in progress. Please wait and retry.",
    );

  if (claim.status === "stale")
    throw new ReceptionistError(
      "That proposal is no longer current. Review a new proposal.",
    );

  if (claim.status === "expired")
    throw new ReceptionistError(
      "This proposal expired. Ask the receptionist for a fresh one.",
    );

  if (claim.status === "confirmed") return claim.state;

  const session = claim.session;
  try {
    const receipt = await createBooking(
      db,
      { slug },
      session.pending!.input,
      origin,
      now,
      "receptionist",
    );
    const saved = await completeChatConfirmation(
      db,
      session.id,
      claim.lease,
      receipt.id,
    );
    if (!saved)
      throw new ReceptionistError(
        "Please retry confirmation to retrieve the booking result.",
      );

    console.info(JSON.stringify({ event: "receptionist_booking_confirmed" }));

    return toChatState(saved);
  } catch (error) {
    await releaseChatLease(db, session.id, claim.lease);
    throw error;
  }
}
