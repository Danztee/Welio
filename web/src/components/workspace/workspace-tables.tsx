"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Grid, Status } from "@/components/platform/shared";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { MembershipRole } from "@/lib/domain/workspaces/enums";
import {
  MoreHorizontalIcon,
  PencilIcon,
  SendIcon,
  UsersIcon,
} from "lucide-react";

type Data = WorkspaceDashboardData;
type EditorKind = "service" | "staff" | "assignments";

type Props = {
  section: "Services" | "Team";
  data: Data;
  owner: boolean;
  money: (minorUnits: number) => string;
  onOpen: (kind: EditorKind, id?: string) => void;
  onInvite: (email: string) => Promise<void>;
};

export function WorkspaceTables({
  section,
  data,
  owner,
  money,
  onOpen,
  onInvite,
}: Props) {
  if (section === "Services")
    return (
      <ServiceTable data={data} owner={owner} money={money} onOpen={onOpen} />
    );

  return (
    <TeamTable
      data={data}
      owner={owner}
      money={money}
      onOpen={onOpen}
      onInvite={onInvite}
    />
  );
}

function ServiceTable({
  data,
  owner,
  money,
  onOpen,
}: Omit<Props, "section" | "onInvite">) {
  return (
    <Grid
      empty={data.services.length ? "No services found" : "No services yet"}
      emptyDescription={
        data.services.length
          ? "Try a different search."
          : owner
            ? "Add a service to start accepting bookings."
            : "Services will appear here once they’re added."
      }
      rows={data.services}
      searchText={(service) =>
        [
          service.name,
          service.description,
          `${service.durationMinutes} min`,
          money(service.priceMinor),
          service.isActive ? "Active" : "Inactive",
          ...data.staff
            .filter(
              (member) =>
                member.isActive &&
                data.assignments.some(
                  (assignment) =>
                    assignment.serviceId === service.id &&
                    assignment.staffId === member.id,
                ),
            )
            .map((member) => member.name),
        ].join(" ")
      }
      columns={[
        {
          label: "Service",
          cell: (service) => (
            <div>
              <p className="font-medium">{service.name}</p>
              <p
                title={service.description ?? undefined}
                className="mt-1 max-w-64 truncate text-xs text-muted-foreground"
              >
                {service.description}
              </p>
            </div>
          ),
        },
        {
          label: "Duration",
          cell: (service) => `${service.durationMinutes} min`,
        },
        { label: "Price", cell: (service) => money(service.priceMinor) },
        {
          label: "Assigned staff",
          cell: (service) =>
            data.staff
              .filter(
                (member) =>
                  member.isActive &&
                  data.assignments.some(
                    (assignment) =>
                      assignment.serviceId === service.id &&
                      assignment.staffId === member.id,
                  ),
              )
              .map((member) => member.name)
              .join(", ") || "Unassigned",
        },
        {
          label: "Status",
          cell: (service) => (
            <Status value={service.isActive ? "Active" : "Inactive"} />
          ),
        },
        ...(owner
          ? [
              {
                label: "Actions",
                cell: (service: Data["services"][number]) => (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Service actions"
                        />
                      }
                    >
                      <MoreHorizontalIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onClick={() => onOpen("assignments", service.id)}
                        >
                          <UsersIcon />
                          Assign team members
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onOpen("service", service.id)}
                        >
                          <PencilIcon />
                          Edit service
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

function TeamTable({ data, owner, onOpen, onInvite }: Omit<Props, "section">) {
  const accessFor = (email: string) => {
    const normalizedEmail = email.toLowerCase();
    if (
      data.members.some(
        (member) => member.email.toLowerCase() === normalizedEmail,
      )
    )
      return "Active";

    if (
      data.invitations.some(
        (invite) =>
          invite.email.toLowerCase() === normalizedEmail &&
          !invite.revokedAt &&
          !invite.acceptedAt &&
          invite.expiresAt.getTime() > Date.now(),
      )
    )
      return "Invited";

    return "No access";
  };

  return (
    <Grid
      empty={
        data.staff.length ? "No team members found" : "No team members yet"
      }
      emptyDescription={
        data.staff.length
          ? "Try a different search."
          : owner
            ? "Add a team member to start accepting bookings."
            : "Team members will appear here once they’re added."
      }
      rows={data.staff}
      searchText={(member) =>
        [
          member.name,
          member.email,
          member.jobTitle,
          member.role === MembershipRole.Owner ? "Owner" : "Team member",
          member.isActive ? "Active" : "Inactive",
          accessFor(member.email),
        ].join(" ")
      }
      columns={[
        {
          label: "Team member",
          cell: (member) => (
            <div>
              <p className="font-medium">{member.name}</p>
              {member.jobTitle !== "Owner" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {member.jobTitle}
                </p>
              )}
            </div>
          ),
        },
        {
          label: "Role",
          cell: (member) =>
            member.role === MembershipRole.Owner ? "Owner" : "Team member",
        },
        { label: "Email", cell: (member) => member.email || "—" },
        {
          label: "Hours",
          cell: (member) => `${member.schedule.start}–${member.schedule.end}`,
        },
        {
          label: "Working days",
          cell: (member) =>
            member.schedule.days
              .map(
                (day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day],
              )
              .join(", "),
        },
        {
          label: "Status",
          cell: (member) => (
            <Status value={member.isActive ? "Active" : "Inactive"} />
          ),
        },
        {
          label: "Dashboard access",
          cell: (member) => <Status value={accessFor(member.email)} />,
        },
        ...(owner
          ? [
              {
                label: "Actions",
                cell: (member: Data["staff"][number]) => (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Team member actions"
                        />
                      }
                    >
                      <MoreHorizontalIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onClick={() => onOpen("staff", member.id)}
                        >
                          <PencilIcon />
                          Edit member
                        </DropdownMenuItem>
                        {accessFor(member.email) !== "Active" && (
                          <DropdownMenuItem
                            onClick={() => onInvite(member.email.toLowerCase())}
                          >
                            <SendIcon />
                            {accessFor(member.email) === "Invited"
                              ? "Resend invitation"
                              : "Send dashboard invite"}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}
