import { randomBytes, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { and, eq, ne, sql } from "drizzle-orm";
import type { Database } from "@/db/connection";
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
} from "@/db/schema";
import {
  workspaceInput,
  serviceInput,
  serviceStaffInput,
  staffInput,
} from "@/lib/workspace-contract";
export class WorkspaceError extends Error {}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function validateWorkspaceLogo(logo: string | null) {
  if (!logo) return;
  const encoded = logo.slice("data:image/webp;base64,".length);
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.length > 450 * 1024 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  )
    throw new WorkspaceError("Choose a valid image smaller than 450 KB.");
}
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export async function authorizeWorkspace(
  tx: Transaction,
  userId: string,
  workspaceId: string,
  owner = false,
) {
  const [member] = await tx
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.workspaceId, workspaceId),
      ),
    )
    .for("update");
  if (!member || (owner && member.role !== "owner"))
    throw new WorkspaceError(
      "You don’t have permission to access this workspace.",
    );
  await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for("update");
  return member;
}
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
  input: unknown,
) {
  const v = workspaceInput.parse(input);
  validateWorkspaceLogo(v.logo);
  return db.transaction(async (tx) => {
    const [creator] = await tx
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!creator) throw new WorkspaceError("Your account could not be found.");
    const owned = await tx.$count(
      memberships,
      and(eq(memberships.userId, userId), eq(memberships.role, "owner")),
    );
    if (owned >= 20)
      throw new WorkspaceError("You can create up to 20 workspaces.");
    const [w] = await tx
      .insert(workspaces)
      .values({ ...v, onboarded: true })
      .returning();
    await tx
      .insert(memberships)
      .values({ workspaceId: w.id, userId, role: "owner" });
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
        createdAt: staff.createdAt,
        updatedAt: staff.updatedAt,
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
      member.role === "owner"
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
      member.role === "owner"
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
      member.role === "owner"
        ? await tx
            .select()
            .from(appointments)
            .where(eq(appointments.workspaceId, workspaceId))
            .orderBy(appointments.startsAt)
        : [];
    const clients =
      member.role === "owner"
        ? await tx
            .select()
            .from(customers)
            .where(eq(customers.workspaceId, workspaceId))
        : [];
    const leave =
      member.role === "owner"
        ? await tx
            .select()
            .from(timeOff)
            .where(eq(timeOff.workspaceId, workspaceId))
        : [];
    const mail =
      member.role === "owner"
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
  input: unknown,
) {
  const v = workspaceInput.parse(input);
  validateWorkspaceLogo(v.logo);
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
export async function saveService(
  db: Database,
  userId: string,
  workspaceId: string,
  input: unknown,
) {
  const v = serviceInput.parse(input);
  await db.transaction(async (tx) => {
    await authorizeWorkspace(tx, userId, workspaceId, true);
    const { staffIds: assignmentIds, price, id, ...values } = v;
    const selectedStaffIds = assignmentIds ?? [];
    const validStaff = selectedStaffIds.length
      ? await tx
          .select({ id: staff.id })
          .from(staff)
          .where(
            and(eq(staff.workspaceId, workspaceId), eq(staff.isActive, true)),
          )
      : [];
    if (selectedStaffIds.some((id) => !validStaff.some((s) => s.id === id)))
      throw new WorkspaceError("Choose active team members in this workspace.");
    let sid = id;
    if (sid) {
      const [updated] = await tx
        .update(services)
        .set({ ...values, priceMinor: Math.round(price * 100) })
        .where(and(eq(services.id, sid), eq(services.workspaceId, workspaceId)))
        .returning({ id: services.id });
      if (!updated) throw new WorkspaceError("Service not found.");
    } else {
      const [created] = await tx
        .insert(services)
        .values({ ...values, workspaceId, priceMinor: Math.round(price * 100) })
        .returning({ id: services.id });
      sid = created.id;
    }
    if (!sid) throw new WorkspaceError("Could not save service.");
    if (assignmentIds !== undefined || !id) {
      await tx
        .update(staffServices)
        .set({ isActive: false })
        .where(
          and(
            eq(staffServices.workspaceId, workspaceId),
            eq(staffServices.serviceId, sid),
          ),
        );
      if (selectedStaffIds.length)
        await tx
          .insert(staffServices)
          .values(
            [...new Set(selectedStaffIds)].map((staffId) => ({
              workspaceId,
              serviceId: sid,
              staffId,
            })),
          )
          .onConflictDoUpdate({
            target: [
              staffServices.workspaceId,
              staffServices.staffId,
              staffServices.serviceId,
            ],
            set: { isActive: true },
          });
    }
  });
}
export async function saveServiceStaff(
  db: Database,
  userId: string,
  workspaceId: string,
  input: unknown,
) {
  const v = serviceStaffInput.parse(input);
  await db.transaction(async (tx) => {
    await authorizeWorkspace(tx, userId, workspaceId, true);
    const [service] = await tx
      .select({ id: services.id })
      .from(services)
      .where(
        and(
          eq(services.id, v.serviceId),
          eq(services.workspaceId, workspaceId),
        ),
      );
    if (!service) throw new WorkspaceError("Service not found.");
    const validStaff = v.staffIds.length
      ? await tx
          .select({ id: staff.id })
          .from(staff)
          .where(
            and(eq(staff.workspaceId, workspaceId), eq(staff.isActive, true)),
          )
      : [];
    if (v.staffIds.some((id) => !validStaff.some((s) => s.id === id)))
      throw new WorkspaceError("Choose active team members in this workspace.");
    await tx
      .update(staffServices)
      .set({ isActive: false })
      .where(
        and(
          eq(staffServices.workspaceId, workspaceId),
          eq(staffServices.serviceId, v.serviceId),
        ),
      );
    if (v.staffIds.length)
      await tx
        .insert(staffServices)
        .values(
          [...new Set(v.staffIds)].map((staffId) => ({
            workspaceId,
            serviceId: v.serviceId,
            staffId,
          })),
        )
        .onConflictDoUpdate({
          target: [
            staffServices.workspaceId,
            staffServices.staffId,
            staffServices.serviceId,
          ],
          set: { isActive: true },
        });
  });
}
export async function saveStaff(
  db: Database,
  userId: string,
  workspaceId: string,
  input: unknown,
) {
  const v = staffInput.parse(input);
  await db.transaction(async (tx) => {
    await authorizeWorkspace(tx, userId, workspaceId, true);
    const { id, ...values } = v;
    const duplicate = await tx
      .select({ id: staff.id })
      .from(staff)
      .where(
        and(
          eq(staff.workspaceId, workspaceId),
          sql`lower(${staff.email}) = lower(${v.email})`,
          id ? ne(staff.id, id) : undefined,
        ),
      )
      .limit(1);
    if (duplicate.length)
      throw new WorkspaceError("A team member with this email already exists.");
    if (id) {
      const [updated] = await tx
        .update(staff)
        .set(values)
        .where(and(eq(staff.id, id), eq(staff.workspaceId, workspaceId)))
        .returning({ id: staff.id });
      if (!updated) throw new WorkspaceError("Staff member not found.");
    } else await tx.insert(staff).values({ ...values, workspaceId });
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
      .values({ workspaceId: i.workspaceId, userId, role: "staff" })
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
            eq(memberships.role, "staff"),
          ),
        );
    }
  });
}
