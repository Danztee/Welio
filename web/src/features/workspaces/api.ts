import "server-only";

import { backendClient } from "@/lib/backend/server-api";
import { fromAPIContract } from "@/lib/api-contract";
import type { CamelFields } from "@/lib/backend/contract";
import * as sdk from "@/lib/backend/generated/sdk.gen";

export type DashboardListOptions = {
  cursor?: string;
  search?: string;
  from?: string;
  to?: string;
  status?: "confirmed" | "completed" | "cancelled" | "no_show";
};

export function workspaceAPI(workspaceId: string) {
  // The client promise belongs to this request, never to a shared user session.
  const client = backendClient(workspaceId);
  const path = { workspaceId };
  async function read<T>(
    operation: (options: {
      client: Awaited<typeof client>;
      path: typeof path;
      throwOnError: true;
    }) => Promise<{ data: T }>,
  ): Promise<CamelFields<T>> {
    const result = await operation({
      client: await client,
      path,
      throwOnError: true,
    });
    return fromAPIContract<CamelFields<T>>(result.data);
  }
  return {
    workspace: () =>
      read((request) =>
        sdk.workspaceGet({ ...request, path: { workspaceID: workspaceId } }),
      ),
    catalog: () =>
      read(({ client, throwOnError }) =>
        sdk.catalogGet({ client, throwOnError }),
      ),
    overview: () => read(sdk.workspaceOverview),
    appointments: (options: DashboardListOptions = {}) =>
      read((request) =>
        sdk.workspaceAppointmentsList({
          ...request,
          query: { limit: 50, ...options },
        }),
      ),
    customerAppointments: (customerId: string, cursor: string) =>
      read((request) =>
        sdk.workspaceAppointmentsList({
          ...request,
          query: { customer_id: customerId, limit: 50, cursor },
        }),
      ),
    customers: (options: DashboardListOptions = {}) =>
      read((request) =>
        sdk.workspaceCustomersList({
          ...request,
          query: { limit: 50, ...options },
        }),
      ),
    receptionist: () =>
      read((request) =>
        sdk.workspaceReceptionistSettingsGet({
          ...request,
          path: { workspaceID: workspaceId },
        }),
      ),
    timeOff: () => read(sdk.workspaceTimeOffList),
    notifications: () => read(sdk.workspaceNotificationsList),
    teamAccess: () =>
      read((request) =>
        sdk.workspaceTeamAccessList({
          ...request,
          path: { workspaceID: workspaceId },
        }),
      ),
    bookingCatalog: () => read(sdk.workspaceBookingCatalog),
  };
}

export type WorkspaceAPI = ReturnType<typeof workspaceAPI>;
