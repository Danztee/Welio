import "server-only";
import type { WorkspacesListResponse } from "@/lib/backend/generated/types.gen";

import { cache } from "react";
import type { Catalog } from "@/lib/domain/bookings/contract";
import { backendClient, BackendError } from "@/lib/backend/server-api";
import { fromAPIContract } from "@/lib/api-contract";
import { workspacesList } from "@/lib/backend/generated/sdk.gen";
import type { CamelFields } from "@/lib/backend/contract";
import type { DashboardSection } from "@/lib/dashboard-routes";
import type { WorkspaceDashboardData, WorkspaceMembership } from "./types";
import {
  workspaceAPI,
  type WorkspaceAPI,
  type DashboardListOptions,
} from "./api";
import {
  dashboardModel,
  membershipRoleSchema,
  bookingLocationSchema,
  type DashboardResources,
} from "./models";

export type { DashboardListOptions } from "./api";

type WorkspaceSection = DashboardSection | "Setup";

export const listWorkspaces = cache(
  async (): Promise<WorkspaceMembership[]> => {
    const response = await workspacesList({
      client: await backendClient(),
      throwOnError: true,
    });
    const items = fromAPIContract<CamelFields<WorkspacesListResponse>>(
      response.data,
    );
    return (items ?? []).map((item) => ({
      ...item,
      role: membershipRoleSchema.parse(item.role),
    }));
  },
);

export async function getWorkspaceDashboard(
  workspaceId: string,
  section: WorkspaceSection = "Setup",
  options: DashboardListOptions = {},
): Promise<WorkspaceDashboardData> {
  const membership = (await listWorkspaces()).find(
    (item) => item.workspace.id === workspaceId,
  );
  if (!membership)
    throw new BackendError("Workspace not found.", 404, "not_found");

  const api = workspaceAPI(workspaceId);
  const [workspace, catalog, sectionData] = await Promise.all([
    api.workspace(),
    needsCatalog(section) ? api.catalog() : null,
    membership.role === "owner" ? loadOwnerSection(api, section, options) : {},
  ]);
  return dashboardModel(
    { workspace, catalog, ...sectionData },
    membership,
    options,
  );
}

function needsCatalog(section: WorkspaceSection): boolean {
  return [
    "Setup",
    "Overview",
    "Services",
    "Team",
    "Appointments",
    "Time off",
  ].includes(section);
}

async function loadOwnerSection(
  api: WorkspaceAPI,
  section: WorkspaceSection,
  options: DashboardListOptions,
): Promise<Omit<DashboardResources, "workspace" | "catalog">> {
  switch (section) {
    case "Overview":
      return { overview: await api.overview() };
    case "Appointments":
      return { appointments: await api.appointments(options) };
    case "Customers":
      return { customers: await api.customers(options) };
    case "Receptionist":
      return { settings: await api.receptionist() };
    case "Time off":
      return { timeOff: await api.timeOff() };
    case "Notifications":
      return { notifications: await api.notifications() };
    case "Members":
    case "Team":
      return { team: await api.teamAccess() };
    default:
      return {};
  }
}

export async function getWorkspaceCatalog(
  workspaceId: string,
): Promise<Catalog> {
  const catalog = await workspaceAPI(workspaceId).bookingCatalog();
  return {
    ...catalog,
    bookingLocation: bookingLocationSchema.parse(catalog.bookingLocation),
    services: (catalog.services ?? []).map((service) => ({
      ...service,
      staffIds: service.staffIds ?? [],
    })),
    staff: catalog.staff ?? [],
  };
}
