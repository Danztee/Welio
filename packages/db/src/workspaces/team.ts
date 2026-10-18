import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import type { Database } from "../connection";
import { staff } from "../schema";
import type { StaffInput } from "@welio/domain/workspaces/contract";
import { WorkspaceError } from "@welio/domain/workspaces/errors";
import { authorizeWorkspace } from "./access";

export async function saveStaff(
  db: Database,
  userId: string,
  workspaceId: string,
  input: StaffInput,
) {
  const v = input;
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
