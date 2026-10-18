import "server-only";

import type { Database } from "@welio/db/connection";
import {
  listWorkspaces as listWorkspaceMemberships,
  workspaceDetail,
} from "@welio/db/workspaces";
import type { WorkspaceDashboardData, WorkspaceMembership } from "./types";

export async function listWorkspaces(
  db: Database,
  userId: string,
): Promise<WorkspaceMembership[]> {
  return listWorkspaceMemberships(db, userId);
}

export async function getWorkspaceDashboard(
  db: Database,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceDashboardData> {
  return workspaceDetail(db, userId, workspaceId);
}
