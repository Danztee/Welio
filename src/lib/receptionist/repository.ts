import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Database } from "@/db/connection";
import { chatSessions, workspaces, appointments } from "@/db/schema";
import { getCatalog, createBooking } from "@/lib/bookings/repository";
import { runReceptionist } from "./gateway";
import type { Model } from "@strands-agents/sdk";
import { ReceptionistError, type ChatState } from "./contract";

const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
type Session = typeof chatSessions.$inferSelect;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
const view = (s: Session): ChatState => ({
  turns: s.turns,
  pending: s.pending,
  receipt: s.receipt,
});
async function sessionIn(tx: Tx, slug: string, token: string, now: Date) {
  const [row] = await tx
    .select({ session: chatSessions, published: workspaces.isPublished })
    .from(chatSessions)
    .innerJoin(workspaces, eq(workspaces.id, chatSessions.workspaceId))
    .where(
      and(
        eq(chatSessions.tokenHash, hash(token)),
        eq(workspaces.slug, slug),
        gt(chatSessions.expiresAt, now),
      ),
    )
    .for("update", { of: chatSessions });
  if (!row || !row.published)
    throw new ReceptionistError(
      "This chat has expired or is unavailable. Start a new conversation.",
      404,
    );
  // Recover committed bookings before an action can discard the pending proposal.
  if (!row.session.receipt && row.session.pending) {
    const [committed] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.workspaceId, row.session.workspaceId),
          eq(appointments.idempotencyKey, row.session.pending.input.key),
        ),
      );
    if (committed) {
      await tx
        .update(chatSessions)
        .set({ receipt: committed.id })
        .where(eq(chatSessions.id, row.session.id));
      row.session.receipt = committed.id;
    }
  }
  return row.session;
}
function available(s: Session, now: Date) {
  if (s.lease && s.leaseUntil && s.leaseUntil > now)
    throw new ReceptionistError(
      "A request is still in progress. Please wait and retry.",
    );
}
const leaseUpdate = (now: Date) => ({
  lease: randomUUID(),
  leaseUntil: new Date(now.getTime() + 120_000),
});
export async function startChat(db: Database, slug: string, now = new Date()) {
  const catalog = await getCatalog(db, { slug }, now);
  const token = randomBytes(32).toString("base64url");
  await db.insert(chatSessions).values({
    workspaceId: catalog.id,
    tokenHash: hash(token),
    expiresAt: new Date(now.getTime() + 60 * 60_000),
  });
  return { token, turns: [], pending: null, receipt: null };
}
export async function chatState(
  db: Database,
  slug: string,
  token: string,
  now = new Date(),
) {
  return db.transaction(async (tx) =>
    view(await sessionIn(tx, slug, token, now)),
  );
}

export async function reserveModelCall(
  db: Database,
  max: number,
  now = new Date(),
) {
  const key = `receptionist:daily:${now.toISOString().slice(0, 10)}`;
  const result = await db.execute(
    sql`insert into auth_rate_limits (key,count,last_request) values (${key},1,${now.getTime()}) on conflict (key) do update set count=auth_rate_limits.count+1 where auth_rate_limits.count<${max} returning count`,
  );
  if (!result.rowCount)
    throw new ReceptionistError(
      "The receptionist has reached today's usage limit. Please use the booking form.",
      429,
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
) {
  const lease = leaseUpdate(now());
  const claimed = await db.transaction(async (tx) => {
    const s = await sessionIn(tx, slug, token, now());
    const old = s.turns.find((t) => t.key === key);
    if (old) {
      if (old.text !== text)
        throw new ReceptionistError(
          "This message key was used for different text.",
        );
      return { cached: view(s), session: null };
    }
    available(s, now());
    if (s.receipt) return { cached: view(s), session: null };
    if (s.turns.length >= 20 || JSON.stringify(s.messages).length > 48_000)
      throw new ReceptionistError(
        "This conversation is full. Start a new chat or use the booking form.",
        422,
      );
    await tx
      .update(chatSessions)
      .set({ ...lease, pending: null })
      .where(eq(chatSessions.id, s.id));
    return { cached: null, session: s };
  });
  if (claimed.cached) return claimed.cached;
  const s = claimed.session!;
  try {
    const result = await runReceptionist({
      db,
      slug,
      messages: [...s.messages, { role: "user", content: [{ text }] }],
      model,
      reserve,
      now,
    });
    const [saved] = await db
      .update(chatSessions)
      .set({
        messages: result.messages,
        turns: [...s.turns, { key, text, reply: result.reply }],
        pending: result.pending,
        lease: null,
        leaseUntil: null,
      })
      .where(
        and(eq(chatSessions.id, s.id), eq(chatSessions.lease, lease.lease)),
      )
      .returning();
    if (!saved)
      throw new ReceptionistError(
        "This request expired. Please reload the conversation.",
      );
    return view(saved);
  } catch (error) {
    await db
      .update(chatSessions)
      .set({ lease: null, leaseUntil: null })
      .where(
        and(eq(chatSessions.id, s.id), eq(chatSessions.lease, lease.lease)),
      );
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
  return db.transaction(async (tx) => {
    const s = await sessionIn(tx, slug, token, now);
    available(s, now);
    if (s.receipt) return view(s);
    if (s.pending?.id !== proposalId)
      throw new ReceptionistError("That proposal is no longer current.");
    const [saved] = await tx
      .update(chatSessions)
      .set({ pending: null })
      .where(eq(chatSessions.id, s.id))
      .returning();
    return view(saved);
  });
}
export async function confirmProposal(
  db: Database,
  slug: string,
  token: string,
  proposalId: string,
  origin: string,
  now = new Date(),
) {
  const lease = leaseUpdate(now);
  const s = await db.transaction(async (tx) => {
    const s = await sessionIn(tx, slug, token, now);
    available(s, now);
    if (s.pending?.id !== proposalId)
      throw new ReceptionistError(
        "That proposal is no longer current. Review a new proposal.",
      );
    if (s.receipt) return s;
    const [committed] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.workspaceId, s.workspaceId),
          eq(appointments.idempotencyKey, s.pending.input.key),
        ),
      );
    if (!committed && new Date(s.pending.expiresAt) <= now)
      throw new ReceptionistError(
        "This proposal expired. Ask the receptionist for a fresh one.",
      );
    await tx.update(chatSessions).set(lease).where(eq(chatSessions.id, s.id));
    return s;
  });
  if (s.receipt) return view(s);
  try {
    const receipt = await createBooking(
      db,
      { slug },
      s.pending!.input,
      origin,
      now,
      "receptionist",
    );
    const [saved] = await db
      .update(chatSessions)
      .set({ receipt: receipt.id, lease: null, leaseUntil: null })
      .where(
        and(eq(chatSessions.id, s.id), eq(chatSessions.lease, lease.lease)),
      )
      .returning();
    if (!saved)
      throw new ReceptionistError(
        "Please retry confirmation to retrieve the booking result.",
      );
    console.info(JSON.stringify({ event: "receptionist_booking_confirmed" }));
    return view(saved);
  } catch (error) {
    await db
      .update(chatSessions)
      .set({ lease: null, leaseUntil: null })
      .where(
        and(eq(chatSessions.id, s.id), eq(chatSessions.lease, lease.lease)),
      );
    throw error;
  }
}
