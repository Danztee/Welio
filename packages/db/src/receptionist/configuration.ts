import "server-only";

import { eq } from "drizzle-orm";
import type { Database } from "../connection";
import { workspaces } from "../schema";
import { getCatalog } from "../bookings/repository";
import { authorizeWorkspace } from "../workspaces/repository";
import { BookingError } from "@welio/domain/bookings/errors";
import {
  receptionistSettingsSchema,
  type ReceptionistSettings,
} from "@welio/domain/receptionist/settings";
import type { PreviewScope } from "@welio/domain/receptionist/scope";

export async function loadReceptionistConfiguration(
  db: Database,
  slug: string,
  preview?: PreviewScope,
) {
  const catalog = await getCatalog(db, preview ?? { slug });
  const [workspace] = await db
    .select({ settings: workspaces.receptionistSettings })
    .from(workspaces)
    .where(eq(workspaces.id, catalog.id));
  if (!workspace) throw new BookingError("Business not found.", "not_found");

  return receptionistSettingsSchema.parse(workspace.settings);
}

export async function saveReceptionistConfiguration(
  db: Database,
  userId: string,
  workspaceId: string,
  settings: ReceptionistSettings,
) {
  await db.transaction(async (tx) => {
    await authorizeWorkspace(tx, userId, workspaceId, true);
    await tx
      .update(workspaces)
      .set({ receptionistSettings: settings })
      .where(eq(workspaces.id, workspaceId));
  });
}
