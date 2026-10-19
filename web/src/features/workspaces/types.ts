import type { AppointmentStatus } from "@/lib/domain/bookings/enums";
import type { ReceptionistSettings } from "@/lib/domain/receptionist/settings";
import type {
  BookingLocation,
  MembershipRole,
} from "@/lib/domain/workspaces/enums";

export type WorkspaceSummary = {
  id: string;
  name: string;
  onboarded: boolean;
};

export type WorkspaceMembership = {
  workspace: WorkspaceSummary;
  role: MembershipRole;
};

export type WorkspaceDashboardData = {
  overview: {
    today: string;
    customers: number;
    todayCount: number;
    confirmed: number;
    completed: number;
    daily: { date: string; count: number }[];
    activity: { id: string; title: string; createdAt: string }[];
  } | null;
  pagination: {
    total: number;
    nextCursor: string;
    search: string;
    status: string;
    from: string;
    to: string;
  } | null;
  workspace: {
    id: string;
    name: string;
    logo: string | null;
    slug: string;
    timeZone: string;
    currency: string;
    contactEmail: string | null;
    serviceArea: string | null;
    businessAddress: string | null;
    bookingLocation: BookingLocation;
    isPublished: boolean;
    phone: string;
    onboarded: boolean;
    leadHours: number;
    horizonDays: number;
    cancelHours: number;
    slotMinutes: number;
    receptionistSettings: ReceptionistSettings;
    remindersEnabled: boolean;
  };
  role: MembershipRole;
  bookings: {
    id: string;
    workspaceId: string;
    customerId: string;
    serviceId: string;
    staffId: string;
    status: AppointmentStatus;
    startsAt: Date;
    endsAt: Date;
    serviceName: string;
    staffName: string;
    durationMinutes: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    priceMinor: number;
    currency: string;
    serviceAddress: string | null;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    notificationConsent: boolean;
    timeZone: string;
    source: string;
    version: number;
    idempotencyKey: string | null;
    createdAt: Date;
  }[];
  customers: {
    appointmentCount: number;
    id: string;
    workspaceId: string;
    name: string;
    email: string | null;
    phone: string | null;
    createdAt: Date;
  }[];
  timeOff: {
    id: string;
    workspaceId: string;
    staffId: string;
    from: string;
    to: string;
    reason: string;
  }[];
  notifications: {
    id: string;
    recipient: string;
    subject: string;
    kind: string;
    status: string;
    attempts: number;
    createdAt: Date;
  }[];
  services: {
    id: string;
    workspaceId: string;
    name: string;
    description: string | null;
    durationMinutes: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    priceMinor: number;
    isActive: boolean;
  }[];
  staff: {
    id: string;
    workspaceId: string;
    userId: string | null;
    name: string;
    email: string;
    jobTitle: string;
    schedule: {
      start: string;
      end: string;
      breakStart: string;
      breakEnd: string;
      days: number[];
    };
    isActive: boolean;
    role: MembershipRole | null;
  }[];
  assignments: {
    workspaceId: string;
    staffId: string;
    serviceId: string;
    isActive: boolean;
  }[];
  members: {
    userId: string;
    name: string;
    email: string;
    role: MembershipRole;
  }[];
  invitations: {
    id: string;
    email: string;
    expiresAt: Date;
    acceptedAt: Date | null;
    revokedAt: Date | null;
  }[];
};
