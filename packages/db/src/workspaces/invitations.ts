import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../connection";
import { workspaces, memberships, invitations, users } from "../schema";
import { WorkspaceError } from "@welio/domain/workspaces/errors";
import { MembershipRole } from "@welio/domain/workspaces/enums";
import { authorizeWorkspace } from "./access";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function inviteMember(
  db: Database,
  userId: string,
  workspaceId: string,
  email: string,
) {
  const token = randomBytes(32).toString("base64url");
  const result = await db.transaction(async (tx) => {
    await authorizeWorkspace(tx, userId, workspaceId, true);
    const [w] = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    const members = await tx
      .select({ email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, workspaceId));
    const count = await tx.$count(
      invitations,
      and(
        eq(invitations.workspaceId, workspaceId),
        sql`${invitations.createdAt}>now()-interval '1 hour'`,
      ),
    );
    if (members.some((m) => m.email.toLowerCase() === email.toLowerCase()))
      throw new WorkspaceError("This person is already a member.");

    if (count >= 10)
      throw new WorkspaceError("Invitation limit reached. Try again later.");

    await tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invitations.workspaceId, workspaceId),
          eq(invitations.email, email),
          sql`${invitations.acceptedAt} is null`,
          sql`${invitations.revokedAt} is null`,
        ),
      );
    const [i] = await tx
      .insert(invitations)
      .values({
        workspaceId,
        email: email.toLowerCase(),
        invitedBy: userId,
        tokenHash: digest(token),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      })
      .returning();

    return { id: i.id, name: w.name };
  });

  return { ...result, token };
}

export async function invitationDetail(
  db: Database,
  userId: string,
  email: string,
  token: string,
) {
  const [recipient] = await db
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId));
  if (
    !recipient ||
    !recipient.emailVerified ||
    recipient.email.toLowerCase() !== email.toLowerCase()
  )
    throw new WorkspaceError("Verify and sign in with the invited account.");

  const [i] = await db
    .select({
      id: invitations.id,
      workspaceId: invitations.workspaceId,
      name: workspaces.name,
      email: invitations.email,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      revokedAt: invitations.revokedAt,
    })
    .from(invitations)
    .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
    .where(eq(invitations.tokenHash, digest(token)));
  if (
    !i ||
    i.email !== email.toLowerCase() ||
    i.revokedAt ||
    i.acceptedAt ||
    i.expiresAt <= new Date()
  )
    throw new WorkspaceError(
      "This invitation is invalid, expired, already accepted, or addressed to another account.",
    );

  return i;
}

export async function acceptInvitation(
  db: Database,
  userId: string,
  email: string,
  token: string,
) {
  return db.transaction(async (tx) => {
    const [recipient] = await tx
      .select({ email: users.email, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, userId));
    if (
      !recipient ||
      !recipient.emailVerified ||
      recipient.email.toLowerCase() !== email.toLowerCase()
    )
      throw new WorkspaceError("Verify and sign in with the invited account.");

    const [i] = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, digest(token)))
      .for("update");
    if (
      !i ||
      i.email !== email.toLowerCase() ||
      i.revokedAt ||
      i.acceptedAt ||
      i.expiresAt <= new Date()
    )
      throw new WorkspaceError(
        "This invitation is invalid, expired, already accepted, or addressed to another account.",
      );

    await tx
      .insert(memberships)
      .values({
        workspaceId: i.workspaceId,
        userId,
        role: MembershipRole.Staff,
      })
      .onConflictDoNothing();
    await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(invitations.id, i.id));

    return i.workspaceId;
  });
}

export async function revokeAccess(
  db: Database,
  userId: string,
  workspaceId: string,
  target: string,
  kind: "member" | "invitation",
) {
  await db.transaction(async (tx) => {
    await authorizeWorkspace(tx, userId, workspaceId, true);
    if (kind === "invitation")
      await tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(invitations.workspaceId, workspaceId),
            eq(invitations.id, target),
          ),
        );
    else {
      if (userId === target)
        throw new WorkspaceError("You cannot revoke your own access.");

      await tx
        .delete(memberships)
        .where(
          and(
            eq(memberships.workspaceId, workspaceId),
            eq(memberships.userId, target),
            eq(memberships.role, MembershipRole.Staff),
          ),
        );
    }
  });
}
