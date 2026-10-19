import type {
  CatalogGetResponse,
  WorkspaceAppointmentsListResponse,
  WorkspaceCustomersListResponse,
  WorkspaceGetResponse,
  WorkspaceNotificationsListResponse,
  WorkspaceOverviewResponse,
  WorkspaceReceptionistSettingsGetResponse,
  WorkspaceTeamAccessListResponse,
  WorkspaceTimeOffListResponse,
} from "@/lib/backend/generated/types.gen";
import { z } from "zod";
import type { CamelFields, APIModel } from "@/lib/backend/contract";
import { MembershipRole, BookingLocation } from "@/lib/domain/workspaces/enums";
import { AppointmentStatus } from "@/lib/domain/bookings/enums";
import {
  defaultReceptionistSettings,
  receptionistSettingsSchema,
} from "@/lib/domain/receptionist/settings";
import type { WorkspaceDashboardData, WorkspaceMembership } from "./types";
import type { DashboardListOptions } from "./api";

export const membershipRoleSchema = z.enum(MembershipRole);
export const bookingLocationSchema = z.enum(BookingLocation);
const appointmentStatusSchema = z.enum(AppointmentStatus);

export function appointmentModel(
  a: APIModel<"Appointment">,
): WorkspaceDashboardData["bookings"][number] {
  return {
    ...a,
    status: appointmentStatusSchema.parse(a.status),
    startsAt: new Date(a.startsAt),
    endsAt: new Date(a.endsAt),
    createdAt: new Date(a.createdAt),
    idempotencyKey: null,
  };
}

export type DashboardResources = {
  workspace: CamelFields<WorkspaceGetResponse>;
  catalog?: CamelFields<CatalogGetResponse> | null;
  overview?: CamelFields<WorkspaceOverviewResponse> | null;
  appointments?: CamelFields<WorkspaceAppointmentsListResponse> | null;
  customers?: CamelFields<WorkspaceCustomersListResponse> | null;
  settings?: CamelFields<WorkspaceReceptionistSettingsGetResponse> | null;
  timeOff?: CamelFields<WorkspaceTimeOffListResponse> | null;
  notifications?: CamelFields<WorkspaceNotificationsListResponse> | null;
  team?: CamelFields<WorkspaceTeamAccessListResponse> | null;
};

export function dashboardModel(
  resources: DashboardResources,
  membership: WorkspaceMembership,
  options: DashboardListOptions,
): WorkspaceDashboardData {
  const {
    workspace,
    catalog,
    overview,
    appointments,
    customers,
    settings,
    timeOff,
    notifications,
    team,
  } = resources;
  const page = appointments ?? customers;
  return {
    workspace: {
      ...workspace,
      bookingLocation: bookingLocationSchema.parse(workspace.bookingLocation),
      receptionistSettings: settings
        ? receptionistSettingsSchema.parse(settings)
        : defaultReceptionistSettings,
    },
    role: membership.role,
    bookings: (appointments?.items ?? overview?.todayAppointments ?? []).map(
      appointmentModel,
    ),
    customers: (customers?.items ?? []).map((item) => ({
      ...item,
      createdAt: new Date(item.createdAt),
    })),
    overview: overview
      ? {
          today: overview.today,
          customers: overview.customers,
          todayCount: overview.todayCount,
          confirmed: overview.confirmed,
          completed: overview.completed,
          daily: overview.daily ?? [],
          activity: overview.activity ?? [],
        }
      : null,
    pagination: page
      ? {
          total: page.total,
          nextCursor: page.nextCursor,
          search: options.search ?? "",
          status: options.status ?? "",
          from: options.from ?? "",
          to: options.to ?? "",
        }
      : null,
    timeOff: timeOff ?? [],
    notifications: (notifications ?? []).map((item) => ({
      ...item,
      createdAt: new Date(item.createdAt),
    })),
    services: catalog?.services ?? [],
    staff: (catalog?.staff ?? []).map((item) => ({
      ...item,
      schedule: { ...item.schedule, days: item.schedule.days ?? [] },
      role: item.role ? membershipRoleSchema.parse(item.role) : null,
    })),
    assignments: catalog?.assignments ?? [],
    members: (team?.members ?? []).map((item) => ({
      ...item,
      role: membershipRoleSchema.parse(item.role),
    })),
    invitations: (team?.invitations ?? []).map((item) => ({
      ...item,
      expiresAt: new Date(item.expiresAt),
      acceptedAt: item.acceptedAt ? new Date(item.acceptedAt) : null,
      revokedAt: item.revokedAt ? new Date(item.revokedAt) : null,
    })),
  };
}
