import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../connection";
import {
  workspaces,
  memberships,
  services,
  staff,
  staffServices,
  invitations,
  users,
  appointments,
  customers,
  timeOff,
  emailOutbox,
} from "../schema";
import type { WorkspaceInput } from "@welio/domain/workspaces/contract";
import { MembershipRole } from "@welio/domain/workspaces/enums";
import { WorkspaceError } from "@welio/domain/workspaces/errors";
import { authorizeWorkspace } from "./access";

export async function listWorkspaces(db: Database, userId: string) {
  return db
    .select({
      workspace: {
        id: workspaces.id,
        name: workspaces.name,
        onboarded: workspaces.onboarded,
      },
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId));
}

export async function createWorkspace(
  db: Database,
  userId: string,
  input: WorkspaceInput,
) {
  const v = input;

  return db.transaction(async (tx) => {
    const [creator] = await tx
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!creator) throw new WorkspaceError("Your account could not be found.");

    const owned = await tx.$count(
      memberships,
      and(
        eq(memberships.userId, userId),
        eq(memberships.role, MembershipRole.Owner),
      ),
    );
    if (owned >= 20)
      throw new WorkspaceError("You can create up to 20 workspaces.");

    const [w] = await tx
      .insert(workspaces)
      .values({ ...v, onboarded: true })
      .returning();
    await tx
      .insert(memberships)
      .values({ workspaceId: w.id, userId, role: MembershipRole.Owner });
    await tx.insert(staff).values({
      workspaceId: w.id,
      userId,
      name: creator.name,
      email: creator.email,
      jobTitle: "Owner",
    });

    return w.id;
  });
}

export async function workspaceDetail(
  db: Database,
  userId: string,
  workspaceId: string,
) {
  return db.transaction(async (tx) => {
    const member = await authorizeWorkspace(tx, userId, workspaceId);
    const [w] = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    const catalog = await tx
      .select()
      .from(services)
      .where(eq(services.workspaceId, workspaceId));
    const team = await tx
      .select({
        id: staff.id,
        workspaceId: staff.workspaceId,
        userId: staff.userId,
        name: sql<string>`coalesce(${users.name}, ${staff.name})`,
        email: sql<string>`coalesce(${users.email}, ${staff.email})`,
        jobTitle: staff.jobTitle,
        schedule: staff.schedule,
        isActive: staff.isActive,
        role: memberships.role,
      })
      .from(staff)
      .leftJoin(users, eq(users.id, staff.userId))
      .leftJoin(
        memberships,
        and(
          eq(memberships.workspaceId, staff.workspaceId),
          eq(memberships.userId, staff.userId),
        ),
      )
      .where(eq(staff.workspaceId, workspaceId));
    const assignments = await tx
      .select()
      .from(staffServices)
      .where(
        and(
          eq(staffServices.workspaceId, workspaceId),
          eq(staffServices.isActive, true),
        ),
      );
    const members =
      member.role === MembershipRole.Owner
        ? await tx
            .select({
              userId: users.id,
              name: users.name,
              email: users.email,
              role: memberships.role,
            })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(eq(memberships.workspaceId, workspaceId))
        : [];
    const pending =
      member.role === MembershipRole.Owner
        ? await tx
            .select({
              id: invitations.id,
              email: invitations.email,
              expiresAt: invitations.expiresAt,
              acceptedAt: invitations.acceptedAt,
              revokedAt: invitations.revokedAt,
            })
            .from(invitations)
            .where(eq(invitations.workspaceId, workspaceId))
        : [];
    const bookings =
      member.role === MembershipRole.Owner
        ? await tx
            .select()
            .from(appointments)
            .where(eq(appointments.workspaceId, workspaceId))
            .orderBy(appointments.startsAt)
        : [];
    const clients =
      member.role === MembershipRole.Owner
        ? await tx
            .select()
            .from(customers)
            .where(eq(customers.workspaceId, workspaceId))
        : [];
    const leave =
      member.role === MembershipRole.Owner
        ? await tx
            .select()
            .from(timeOff)
            .where(eq(timeOff.workspaceId, workspaceId))
        : [];
    const mail =
      member.role === MembershipRole.Owner
        ? await tx
            .select({
              id: emailOutbox.id,
              recipient: emailOutbox.recipient,
              subject: emailOutbox.subject,
              kind: emailOutbox.kind,
              status: emailOutbox.status,
              attempts: emailOutbox.attempts,
              createdAt: emailOutbox.createdAt,
            })
            .from(emailOutbox)
            .where(eq(emailOutbox.workspaceId, workspaceId))
            .orderBy(emailOutbox.createdAt)
        : [];

    return {
      bookings: bookings.map(
        ({ managementTokenHash, requestFingerprint, ...record }) => {
          void managementTokenHash;
          void requestFingerprint;

          return record;
        },
      ),
      customers: clients,
      timeOff: leave,
      notifications: mail,
      workspace: w,
      role: member.role,
      services: catalog,
      staff: team,
      assignments,
      members,
      invitations: pending,
    };
  });
}

export async function saveBusiness(
  db: Database,
  userId: string,
  workspaceId: string,
  input: WorkspaceInput,
) {
  const v = input;
  await db.transaction(async (tx) => {
    await authorizeWorkspace(tx, userId, workspaceId, true);
    const [current] = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    if (current.currency !== v.currency || current.timeZone !== v.timeZone) {
      const result = await tx.execute(
        sql`select 1 from appointments where workspace_id=${workspaceId} limit 1`,
      );
      if (result.rows.length)
        throw new WorkspaceError(
          "Currency and time zone cannot change after bookings exist.",
        );
    }

    await tx
      .update(workspaces)
      .set({ ...v, onboarded: true })
      .where(eq(workspaces.id, workspaceId));
  });
}

export async function finishSetup(
  db: Database,
  userId: string,
  workspaceId: string,
) {
  await db.transaction(async (tx) => {
    await authorizeWorkspace(tx, userId, workspaceId, true);
    await tx
      .update(workspaces)
      .set({ onboarded: true })
      .where(eq(workspaces.id, workspaceId));
  });
}
