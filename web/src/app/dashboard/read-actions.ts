"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { workspaceAPI } from "@/features/workspaces/api";
import { appointmentModel } from "@/features/workspaces/models";

export async function customerAppointments(
  workspaceId: string,
  customerId: string,
  cursor = "",
) {
  await requireUser();
  const workspace = z.uuid().parse(workspaceId);
  const page = await workspaceAPI(workspace).customerAppointments(
    z.uuid().parse(customerId),
    z.string().max(200).parse(cursor),
  );
  return { ...page, items: (page.items ?? []).map(appointmentModel) };
}

export async function dashboardNotifications(workspaceId: string) {
  await requireUser();
  const id = z.uuid().parse(workspaceId);
  const items = await workspaceAPI(id).notifications();
  return (items ?? []).map((item) => ({
    ...item,
    createdAt: new Date(item.createdAt),
  }));
}
