import { boolOptions } from "@/components/platform/form-utils";
import type { EditorField } from "@/components/platform/shared";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";

export type WorkspaceEditorKind =
  "service" | "staff" | "invite" | "account" | "assignments" | null;

type Data = WorkspaceDashboardData;
export function getEditorFields({
  editor,
  service,
  worker,
  workspace,
  data,
  recordId,
  user,
}: {
  editor: WorkspaceEditorKind;
  service: Data["services"][number] | undefined;
  worker: Data["staff"][number] | undefined;
  workspace: Data["workspace"] | undefined;
  data: Data | null;
  recordId: string;
  user: { firstName?: string | null; lastName?: string | null };
}): EditorField[] {
  const assignmentField: EditorField = {
    name: "staff",
    label: "Team members",
    type: "multi",
    description: "Choose who can take appointments for this service.",
    emptyMessage:
      "Add an active team member in Team before assigning this service.",
    value:
      data?.assignments
        .filter((a) => a.serviceId === recordId)
        .map((a) => a.staffId) ?? [],
    options:
      data?.staff
        .filter((s) => s.isActive)
        .map((s) => ({ value: s.id, label: s.name })) ?? [],
  };

  return editor === "assignments"
    ? [assignmentField]
    : editor === "service"
      ? [
          {
            name: "name",
            label: "Service name",
            required: true,
            value: service?.name,
          },
          {
            name: "description",
            label: "Description",
            type: "textarea",
            value: service?.description ?? "",
          },
          {
            name: "durationMinutes",
            label: "Duration (minutes)",
            type: "number",
            value: service?.durationMinutes ?? 60,
            required: true,
            min: 15,
            max: 480,
            step: 15,
          },
          {
            name: "price",
            label: `Price (${workspace?.currency})`,
            type: "number",
            value: (service?.priceMinor ?? 1500000) / 100,
            required: true,
            min: 0,
            max: 10000000,
            step: 0.01,
          },
          {
            name: "bufferBeforeMinutes",
            label: "Buffer before (minutes)",
            type: "number",
            value: service?.bufferBeforeMinutes ?? 0,
            min: 0,
            max: 180,
          },
          {
            name: "bufferAfterMinutes",
            label: "Buffer after (minutes)",
            type: "number",
            value: service?.bufferAfterMinutes ?? 0,
            min: 0,
            max: 180,
          },
          {
            name: "active",
            label: "Active",
            type: "select",
            value: String(service?.isActive ?? true),
            options: boolOptions,
          },
          ...(!recordId ? [assignmentField] : []),
        ]
      : editor === "staff"
        ? [
            {
              name: "name",
              label: "Full name",
              autoComplete: "name",
              required: true,
              value: worker?.name,
            },
            {
              name: "email",
              label: "Email",
              type: "email",
              autoComplete: "email",
              required: true,
              value: worker?.email,
            },
            {
              name: "jobTitle",
              label: "Job title",
              autoComplete: "organization-title",
              value: worker?.jobTitle ?? "Service specialist",
            },
            {
              name: "start",
              label: "Start time",
              type: "time",
              required: true,
              value: worker?.schedule.start ?? "09:00",
            },
            {
              name: "end",
              label: "End time",
              type: "time",
              required: true,
              value: worker?.schedule.end ?? "17:00",
            },
            {
              name: "breakStart",
              label: "Break starts (optional)",
              type: "time",
              value: worker?.schedule.breakStart ?? "",
            },
            {
              name: "breakEnd",
              label: "Break ends (optional)",
              type: "time",
              value: worker?.schedule.breakEnd ?? "",
            },
            {
              name: "days",
              label: "Working days",
              type: "multi",
              value: (worker?.schedule.days ?? [1, 2, 3, 4, 5]).map(String),
              options: [
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ].map((label, i) => ({ value: String(i), label })),
            },
            {
              name: "active",
              label: "Active",
              type: "select",
              value: String(worker?.isActive ?? true),
              options: boolOptions,
            },
          ]
        : editor === "invite"
          ? [
              {
                name: "email",
                label: "Team member email",
                type: "email",
                autoComplete: "email",
                required: true,
              },
            ]
          : [
              {
                name: "firstName",
                label: "First name",
                autoComplete: "given-name",
                value: user.firstName ?? "",
                required: true,
              },
              {
                name: "lastName",
                label: "Last name",
                autoComplete: "family-name",
                value: user.lastName ?? "",
                required: true,
              },
            ];
}
