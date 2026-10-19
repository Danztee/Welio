import "server-only";

import type { Catalog } from "@/lib/domain/bookings/contract";
import {
  defaultReceptionistSettings,
  type ReceptionistSettings,
} from "@/lib/domain/receptionist/settings";
import type { MembershipRole } from "@/lib/domain/workspaces/enums";
import { backendRequest, BackendError } from "@/lib/backend/server-api";
import type { WorkspaceDashboardData, WorkspaceMembership } from "./types";

type ApiWorkspace = Omit<
  WorkspaceDashboardData["workspace"],
  "receptionistSettings"
>;
type ApiAppointment = Omit<
  WorkspaceDashboardData["bookings"][number],
  "startsAt" | "endsAt" | "createdAt" | "idempotencyKey"
> & {
  startsAt: string;
  endsAt: string;
  createdAt: string;
};
type ApiCustomer = Omit<
  WorkspaceDashboardData["customers"][number],
  "createdAt"
> & { createdAt: string };
type ApiNotification = Omit<
  WorkspaceDashboardData["notifications"][number],
  "createdAt"
> & { createdAt: string };
type ApiTeamAccess = {
  members: WorkspaceDashboardData["members"];
  invitations: Array<
    Omit<
      WorkspaceDashboardData["invitations"][number],
      "expiresAt" | "acceptedAt" | "revokedAt"
    > & {
      createdAt: string;
      expiresAt: string;
      acceptedAt: string | null;
      revokedAt: string | null;
    }
  >;
};

export function listWorkspaces(): Promise<WorkspaceMembership[]> {
  return backendRequest("/v1/workspaces");
}

export async function getWorkspaceDashboard(
  workspaceId: string,
): Promise<WorkspaceDashboardData> {
  const workspaces = await listWorkspaces();
  const membership = workspaces.find(
    (item) => item.workspace.id === workspaceId,
  );
  if (!membership)
    throw new BackendError("Workspace not found.", 404, "not_found");

  const workspacePath = `/v1/workspaces/${workspaceId}`;
  const [workspace, catalog] = await Promise.all([
    backendRequest<ApiWorkspace>(workspacePath, { workspaceId }),
    backendRequest<{
      services: WorkspaceDashboardData["services"];
      staff: WorkspaceDashboardData["staff"];
      assignments: WorkspaceDashboardData["assignments"];
    }>("/v1/catalog", { workspaceId }),
  ]);

  const ownerData =
    membership.role === "owner"
      ? await Promise.all([
          backendRequest<ReceptionistSettings>(
            `${workspacePath}/receptionist`,
            { workspaceId },
          ),
          backendRequest<ApiAppointment[]>(`${workspacePath}/appointments`, {
            workspaceId,
          }),
          backendRequest<ApiCustomer[]>(`${workspacePath}/customers`, {
            workspaceId,
          }),
          backendRequest<WorkspaceDashboardData["timeOff"]>(
            `${workspacePath}/time-off`,
            { workspaceId },
          ),
          backendRequest<ApiNotification[]>(`${workspacePath}/notifications`, {
            workspaceId,
          }),
          backendRequest<ApiTeamAccess>(`${workspacePath}/team-access`, {
            workspaceId,
          }),
        ])
      : null;

  const [
    receptionistSettings,
    appointments,
    customers,
    timeOff,
    notifications,
    teamAccess,
  ] = ownerData ?? [
    defaultReceptionistSettings,
    [],
    [],
    [],
    [],
    { members: [], invitations: [] },
  ];

  return {
    workspace: {
      ...workspace,
      receptionistSettings,
    },
    role: membership.role as MembershipRole,
    bookings: appointments.map((appointment) => ({
      ...appointment,
      startsAt: new Date(appointment.startsAt),
      endsAt: new Date(appointment.endsAt),
      createdAt: new Date(appointment.createdAt),
      // Idempotency keys are internal mutation tokens, never dashboard data.
      idempotencyKey: null,
    })),
    customers: customers.map((customer) => ({
      ...customer,
      createdAt: new Date(customer.createdAt),
    })),
    timeOff,
    notifications: notifications.map((notification) => ({
      ...notification,
      createdAt: new Date(notification.createdAt),
    })),
    services: catalog.services,
    staff: catalog.staff,
    assignments: catalog.assignments,
    members: teamAccess.members,
    invitations: teamAccess.invitations.map((invitation) => ({
      ...invitation,
      expiresAt: new Date(invitation.expiresAt),
      acceptedAt: invitation.acceptedAt
        ? new Date(invitation.acceptedAt)
        : null,
      revokedAt: invitation.revokedAt ? new Date(invitation.revokedAt) : null,
    })),
  };
}

export function getWorkspaceCatalog(workspaceId: string): Promise<Catalog> {
  return backendRequest(`/v1/workspaces/${workspaceId}/booking-catalog`, {
    workspaceId,
  });
}
