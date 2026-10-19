export const dashboardRoutes = {
  Overview: "/dashboard",
  Appointments: "/dashboard/appointments",
  Customers: "/dashboard/customers",
  Receptionist: "/dashboard/receptionist",
  Notifications: "/dashboard/notifications",
  Services: "/dashboard/services",
  Team: "/dashboard/team",
  "Time off": "/dashboard/time-off",
  Members: "/dashboard/members",
  Settings: "/dashboard/settings",
} as const;

export type DashboardSection = keyof typeof dashboardRoutes;

export function dashboardHref(section: DashboardSection, workspace?: string) {
  return (
    dashboardRoutes[section] +
    (workspace ? `?workspace=${encodeURIComponent(workspace)}` : "")
  );
}
