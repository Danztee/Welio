import { boolOptions } from "@/components/platform/form-utils";
import type { EditorField } from "@/components/platform/editor-types";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";

export type WorkspaceEditorKind =
  | "service"
  | "staff"
  | "account"
  | "assignments"
  | null;

type Data = WorkspaceDashboardData;
export function getEditorFields({
  editor,
  service,
  data,
  recordId,
  user,
}: {
  editor: WorkspaceEditorKind;
  service: Data["services"][number] | undefined;
  data: Data;
  recordId: string;
  user: { firstName?: string | null; lastName?: string | null };
}): EditorField[] {
  if (editor === "assignments")
    return [
      {
        name: "staff",
        label: "Available team members",
        type: "multi-select",
        emptyMessage:
          "Add an active team member in Team before assigning this service.",
        value: data.assignments
          .filter((assignment) => assignment.serviceId === recordId)
          .map((assignment) => assignment.staffId),
        options: data.staff
          .filter((member) => member.isActive)
          .map((member) => ({ value: member.id, label: member.name })),
      },
    ];
  if (editor === "service")
    return [
      {
        name: "name",
        label: "Service name",
        placeholder: "Enter a service name",
        required: true,
        value: service?.name,
      },
      {
        name: "description",
        label: "Description",
        type: "textarea",
        placeholder: "Describe what the service includes.",
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
        label: `Price (${data.workspace.currency})`,
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
    ];
  if (editor === "account")
    return [
      {
        name: "firstName",
        label: "First name",
        placeholder: "Jane",
        autoComplete: "given-name",
        value: user.firstName ?? "",
        required: true,
      },
      {
        name: "lastName",
        label: "Last name",
        placeholder: "Doe",
        autoComplete: "family-name",
        value: user.lastName ?? "",
        required: true,
      },
    ];
  return [];
}
