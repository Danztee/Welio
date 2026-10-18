import "server-only";
import { and, eq } from "drizzle-orm";
import type { Database } from "../connection";
import { workspaces, memberships } from "../schema";
import { WorkspaceError } from "@welio/domain/workspaces/errors";
import { MembershipRole } from "@welio/domain/workspaces/enums";

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
  if (!member || (owner && member.role !== MembershipRole.Owner))
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
