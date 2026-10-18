import "server-only";
import { and, eq } from "drizzle-orm";
import type { Database } from "../connection";
import { services, staff, staffServices } from "../schema";
import type {
  ServiceInput,
  ServiceStaffInput,
} from "@welio/domain/workspaces/contract";
import { WorkspaceError } from "@welio/domain/workspaces/errors";
import { authorizeWorkspace } from "./access";

export async function saveService(
  db: Database,
  userId: string,
  workspaceId: string,
  input: ServiceInput,
) {
  const v = input;
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
  input: ServiceStaffInput,
) {
  const v = input;
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
