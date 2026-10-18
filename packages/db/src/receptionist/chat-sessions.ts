import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Database } from "../connection";
import { appointments, chatSessions, workspaces } from "../schema";
import type {
  ChatRetry,
  ChatState,
  ChatTurn,
  Proposal,
  StoredConversationMessage,
} from "@welio/domain/receptionist/contract";

export type ChatSession = typeof chatSessions.$inferSelect;

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const toChatState = (session: ChatSession): ChatState => ({
  turns: session.turns,
  pending: session.pending,
  receipt: session.receipt,
  retry: session.activeTurn,
});

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function sessionForUpdate(
  tx: Transaction,
  slug: string,
  token: string,
  now: Date,
) {
  const [row] = await tx
    .select({ session: chatSessions, published: workspaces.isPublished })
    .from(chatSessions)
    .innerJoin(workspaces, eq(workspaces.id, chatSessions.workspaceId))
    .where(
      and(
        eq(chatSessions.tokenHash, hashToken(token)),
        eq(workspaces.slug, slug),
        gt(chatSessions.expiresAt, now),
      ),
    )
    .for("update", { of: chatSessions });

  if (!row?.published) return null;

  if (!row.session.receipt && row.session.pending) {
    const [booking] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.workspaceId, row.session.workspaceId),
          eq(appointments.idempotencyKey, row.session.pending.input.key),
        ),
      );

    if (booking) {
      await tx
        .update(chatSessions)
        .set({ receipt: booking.id })
        .where(eq(chatSessions.id, row.session.id));
      row.session.receipt = booking.id;
    }
  }

  return row.session;
}

export async function createChatSession(
  db: Database,
  workspaceId: string,
  token: string,
  expiresAt: Date,
) {
  const [session] = await db
    .insert(chatSessions)
    .values({
      workspaceId,
      tokenHash: hashToken(token),
      expiresAt,
    })
    .returning({ id: chatSessions.id });

  return session.id;
}

export async function listChatSessionRows(
  db: Database,
  slug: string,
  cookies: { id: string | null; token: string }[],
  now: Date,
) {
  if (!cookies.length) return [];

  return db
    .select({
      id: chatSessions.id,
      tokenHash: chatSessions.tokenHash,
      turns: chatSessions.turns,
      activeTurn: chatSessions.activeTurn,
      updatedAt: chatSessions.updatedAt,
      businessName: workspaces.name,
    })
    .from(chatSessions)
    .innerJoin(workspaces, eq(workspaces.id, chatSessions.workspaceId))
    .where(
      and(
        eq(workspaces.slug, slug),
        eq(workspaces.isPublished, true),
        gt(chatSessions.expiresAt, now),
        inArray(
          chatSessions.tokenHash,
          cookies.map(({ token }) => hashToken(token)),
        ),
      ),
    )
    .orderBy(desc(chatSessions.updatedAt));
}

export async function loadChatSession(
  db: Database,
  slug: string,
  token: string,
  now: Date,
) {
  return db.transaction((tx) => sessionForUpdate(tx, slug, token, now));
}

export type ChatTurnClaim =
  | { status: "unavailable" }
  | { status: "message-key-reused" }
  | { status: "retry-previous" }
  | { status: "busy" }
  | { status: "full" }
  | { status: "cached"; state: ChatState }
  | { status: "claimed"; session: ChatSession; lease: string };

export async function claimChatTurn(
  db: Database,
  input: {
    slug: string;
    token: string;
    key: string;
    text: string;
    now: Date;
  },
): Promise<ChatTurnClaim> {
  return db.transaction(async (tx): Promise<ChatTurnClaim> => {
    const session = await sessionForUpdate(
      tx,
      input.slug,
      input.token,
      input.now,
    );
    if (!session) return { status: "unavailable" };

    const savedTurn = session.turns.find((turn) => turn.key === input.key);
    if (savedTurn) {
      if (savedTurn.text !== input.text)
        return { status: "message-key-reused" };

      return { status: "cached", state: toChatState(session) };
    }

    if (
      session.activeTurn &&
      (session.activeTurn.key !== input.key ||
        session.activeTurn.text !== input.text)
    )
      return { status: "retry-previous" };

    if (session.lease && session.leaseUntil && session.leaseUntil > input.now)
      return { status: "busy" };

    if (session.receipt)
      return { status: "cached", state: toChatState(session) };

    if (
      session.turns.length >= 20 ||
      JSON.stringify(session.messages).length > 48_000
    )
      return { status: "full" };

    const lease = randomUUID();
    await tx
      .update(chatSessions)
      .set({
        lease,
        leaseUntil: new Date(input.now.getTime() + 120_000),
        activeTurn: { key: input.key, text: input.text },
        pending: null,
      })
      .where(eq(chatSessions.id, session.id));

    return { status: "claimed", session, lease };
  });
}

export async function saveChatTurn(
  db: Database,
  input: {
    sessionId: string;
    lease: string;
    messages: StoredConversationMessage[];
    turns: ChatTurn[];
    activeTurn: ChatRetry | null;
    pending: Proposal | null;
  },
) {
  const [session] = await db
    .update(chatSessions)
    .set({
      messages: input.messages,
      turns: input.turns,
      activeTurn: input.activeTurn,
      pending: input.pending,
      lease: null,
      leaseUntil: null,
    })
    .where(
      and(
        eq(chatSessions.id, input.sessionId),
        eq(chatSessions.lease, input.lease),
      ),
    )
    .returning();

  return session ?? null;
}

export async function releaseChatLease(
  db: Database,
  sessionId: string,
  lease: string,
) {
  await db
    .update(chatSessions)
    .set({ lease: null, leaseUntil: null })
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.lease, lease)));
}

export type RejectProposalResult =
  | { status: "unavailable" }
  | { status: "busy" }
  | { status: "stale" }
  | { status: "saved"; state: ChatState };

export async function rejectChatProposal(
  db: Database,
  input: { slug: string; token: string; proposalId: string; now: Date },
): Promise<RejectProposalResult> {
  return db.transaction(async (tx): Promise<RejectProposalResult> => {
    const session = await sessionForUpdate(
      tx,
      input.slug,
      input.token,
      input.now,
    );
    if (!session) return { status: "unavailable" };

    if (session.lease && session.leaseUntil && session.leaseUntil > input.now)
      return { status: "busy" };

    if (session.receipt)
      return { status: "saved", state: toChatState(session) };

    if (session.pending?.id !== input.proposalId) return { status: "stale" };

    const [saved] = await tx
      .update(chatSessions)
      .set({ pending: null })
      .where(eq(chatSessions.id, session.id))
      .returning();

    return { status: "saved", state: toChatState(saved) };
  });
}

export type ChatConfirmationClaim =
  | { status: "unavailable" }
  | { status: "busy" }
  | { status: "stale" }
  | { status: "expired" }
  | { status: "confirmed"; state: ChatState }
  | { status: "claimed"; session: ChatSession; lease: string };

export async function claimChatConfirmation(
  db: Database,
  input: { slug: string; token: string; proposalId: string; now: Date },
): Promise<ChatConfirmationClaim> {
  return db.transaction(async (tx): Promise<ChatConfirmationClaim> => {
    const session = await sessionForUpdate(
      tx,
      input.slug,
      input.token,
      input.now,
    );
    if (!session) return { status: "unavailable" };

    if (session.lease && session.leaseUntil && session.leaseUntil > input.now)
      return { status: "busy" };

    if (session.pending?.id !== input.proposalId) return { status: "stale" };

    if (session.receipt)
      return { status: "confirmed", state: toChatState(session) };

    const [booking] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.workspaceId, session.workspaceId),
          eq(appointments.idempotencyKey, session.pending.input.key),
        ),
      );
    if (!booking && new Date(session.pending.expiresAt) <= input.now)
      return { status: "expired" };

    const lease = randomUUID();
    await tx
      .update(chatSessions)
      .set({ lease, leaseUntil: new Date(input.now.getTime() + 120_000) })
      .where(eq(chatSessions.id, session.id));

    return { status: "claimed", session, lease };
  });
}

export async function completeChatConfirmation(
  db: Database,
  sessionId: string,
  lease: string,
  receipt: string,
) {
  const [session] = await db
    .update(chatSessions)
    .set({ receipt, lease: null, leaseUntil: null })
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.lease, lease)))
    .returning();

  return session ?? null;
}

export async function reserveModelCall(db: Database, max: number, now: Date) {
  const key = `receptionist:daily:${now.toISOString().slice(0, 10)}`;
  const result = await db.execute(sql`
    INSERT INTO auth_rate_limits (key, count, last_request)
    VALUES (${key}, 1, ${now.getTime()})
    ON CONFLICT (key) DO UPDATE
    SET count = auth_rate_limits.count + 1
    WHERE auth_rate_limits.count < ${max}
    RETURNING count
  `);

  return (result.rowCount ?? 0) > 0;
}
