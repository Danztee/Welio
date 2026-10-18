import { eq } from "drizzle-orm";
import type { Database } from "@/db/connection";
import { workspaces } from "@/db/schema";
import { BookingError, getCatalog } from "@/lib/bookings/repository";
import { authorizeWorkspace } from "@/lib/workspaces/repository";
import { receptionistSettingsSchema } from "./settings";

export type PreviewScope = { userId: string; workspaceId: string };
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
  if (!workspace) throw new BookingError("Business not found.", 404);
  return receptionistSettingsSchema.parse(workspace.settings);
}
export async function saveReceptionistConfiguration(
  db: Database,
  userId: string,
  workspaceId: string,
  input: unknown,
) {
  const settings = receptionistSettingsSchema.parse(input);
  await db.transaction(async (tx) => {
    await authorizeWorkspace(tx, userId, workspaceId, true);
    await tx
      .update(workspaces)
      .set({ receptionistSettings: settings })
      .where(eq(workspaces.id, workspaceId));
  });
}
