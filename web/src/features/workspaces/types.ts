import type * as API from "@/lib/backend/generated/types.gen";
import type { CamelFields } from "@/lib/backend/contract";
import type { AppointmentStatus } from "@/lib/domain/bookings/enums";
import type { ReceptionistSettings } from "@/lib/domain/receptionist/settings";
import type {
  BookingLocation,
  MembershipRole,
} from "@/lib/domain/workspaces/enums";

type Appointment = CamelFields<API.Appointment>;
type Customer = CamelFields<API.Customer>;
type Invitation = CamelFields<API.Invitation>;
type Notification = CamelFields<API.Notification>;
type Overview = CamelFields<API.Overview>;
type Staff = CamelFields<API.StaffOutput>;
type Member = CamelFields<API.TeamMemberAccess>;
type Workspace = CamelFields<API.Workspace>;

export type WorkspaceSummary = CamelFields<API.WorkspaceSummary>["workspace"];

export type WorkspaceMembership = {
  workspace: WorkspaceSummary;
  role: MembershipRole;
};

export type WorkspaceDashboardData = {
  overview:
    | (Omit<Overview, "todayAppointments" | "daily" | "activity"> & {
        daily: NonNullable<Overview["daily"]>;
        activity: NonNullable<Overview["activity"]>;
      })
    | null;
  pagination: {
    total: number;
    nextCursor: string;
    search: string;
    status: string;
    from: string;
    to: string;
  } | null;
  workspace: Omit<Workspace, "bookingLocation"> & {
    bookingLocation: BookingLocation;
    receptionistSettings: ReceptionistSettings;
  };
  role: MembershipRole;
  bookings: (Omit<
    Appointment,
    "status" | "startsAt" | "endsAt" | "createdAt"
  > & {
    status: AppointmentStatus;
    startsAt: Date;
    endsAt: Date;
    createdAt: Date;
  })[];
  customers: (Omit<Customer, "createdAt"> & { createdAt: Date })[];
  timeOff: CamelFields<API.TimeOff>[];
  notifications: (Omit<Notification, "createdAt"> & { createdAt: Date })[];
  services: CamelFields<API.ServiceItem>[];
  staff: (Omit<Staff, "schedule" | "role"> & {
    schedule: Omit<Staff["schedule"], "days"> & { days: number[] };
    role: MembershipRole | null;
  })[];
  assignments: CamelFields<API.Assignment>[];
  members: (Omit<Member, "role"> & { role: MembershipRole })[];
  invitations: (Omit<Invitation, "expiresAt" | "acceptedAt" | "revokedAt"> & {
    expiresAt: Date;
    acceptedAt: Date | null;
    revokedAt: Date | null;
  })[];
};
