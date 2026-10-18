import {
  assignServiceStaffAction,
  inviteWorkspaceMemberAction,
  saveServiceAction,
  saveStaffAction,
} from "@/app/dashboard/workspace-actions";
import { number, text } from "@/components/platform/form-utils";
import type { WorkspaceDashboardData } from "@/features/workspaces/types";
import { authClient } from "@/lib/auth-client";
import { accountNamesSchema } from "@/lib/auth/validation";
import { runServerAction } from "@/lib/run-server-action";
import type { WorkspaceEditorKind } from "./workspace-editor-fields";
import { toast } from "sonner";

type Data = WorkspaceDashboardData;
type MutateOperation = (
  workspaceId: string,
  input: unknown,
) => Promise<{ ok: boolean; error?: string; id?: string }>;

export function createWorkspaceAppActions({
  workspaceId,
  data,
  editor,
  recordId,
  refresh,
}: {
  workspaceId: string;
  data: Data | null;
  editor: WorkspaceEditorKind;
  recordId: string;
  refresh: () => void;
}) {
  async function mutate(operation: MutateOperation, input: unknown) {
    const result = await runServerAction(() => operation(workspaceId, input));
    if (!result.ok) throw Error(result.error);

    refresh();

    return result.id;
  }

  async function save(form: FormData) {
    if (editor === "account") {
      const names = accountNamesSchema.safeParse({
        firstName: text(form, "firstName"),
        lastName: text(form, "lastName"),
      });
      if (!names.success) throw Error(names.error.issues[0].message);

      const result = await authClient.updateUser(names.data);
      if (result.error) throw Error("Could not update your name.");

      refresh();

      return;
    }

    if (!editor) return;

    const input = buildEditorInput(editor, form, recordId);
    await saveEditorInput(editor, input, mutate);

    if (editor === "assignments") {
      toast.success("Team assignments saved.");

      return;
    }

    if (editor === "staff" && !recordId) {
      await inviteNewStaffMember(form, data, mutate);

      return;
    }

    toast.success(
      editor === "invite"
        ? "Invitation sent. It expires in 7 days."
        : "Changes saved.",
    );
  }

  async function resendInvite(email: string) {
    try {
      await mutate(inviteWorkspaceMemberAction, email);
      toast.success("Dashboard invitation sent.");
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Could not send the invitation.",
      );
    }
  }

  return { mutate, save, resendInvite };
}

function buildEditorInput(
  editor: Exclude<WorkspaceEditorKind, "account" | null>,
  form: FormData,
  recordId: string,
) {
  switch (editor) {
    case "staff":
      return {
        ...(recordId ? { id: recordId } : {}),
        name: text(form, "name"),
        email: text(form, "email"),
        jobTitle: text(form, "jobTitle"),
        isActive: text(form, "active") === "true",
        schedule: {
          start: text(form, "start"),
          end: text(form, "end"),
          breakStart: text(form, "breakStart"),
          breakEnd: text(form, "breakEnd"),
          days: form.getAll("days").map(Number),
        },
      };
    case "assignments":
      return {
        serviceId: recordId,
        staffIds: form.getAll("staff").map(String),
      };
    case "service":
      return {
        ...(recordId ? { id: recordId } : {}),
        name: text(form, "name"),
        description: text(form, "description"),
        durationMinutes: number(form, "durationMinutes"),
        price: number(form, "price"),
        bufferBeforeMinutes: number(form, "bufferBeforeMinutes"),
        bufferAfterMinutes: number(form, "bufferAfterMinutes"),
        isActive: text(form, "active") === "true",
      };
    case "invite":
      return text(form, "email").toLowerCase();
  }
}

async function saveEditorInput(
  editor: Exclude<WorkspaceEditorKind, "account" | null>,
  input: unknown,
  mutate: (operation: MutateOperation, input: unknown) => Promise<unknown>,
) {
  switch (editor) {
    case "staff":
      await mutate(saveStaffAction, input);

      return;
    case "assignments":
      await mutate(assignServiceStaffAction, input);

      return;
    case "service":
      await mutate(saveServiceAction, input);

      return;
    case "invite":
      await mutate(inviteWorkspaceMemberAction, input);
  }
}

async function inviteNewStaffMember(
  form: FormData,
  data: Data | null,
  mutate: (operation: MutateOperation, input: unknown) => Promise<unknown>,
) {
  const email = text(form, "email").toLowerCase();
  const alreadyHasAccess = data?.members.some(
    (member) => member.email.toLowerCase() === email,
  );

  if (email && !alreadyHasAccess) {
    try {
      await mutate(inviteWorkspaceMemberAction, email);
      toast.success("Team member added. Dashboard invitation sent.");
    } catch {
      toast.warning(
        "Team member added, but the dashboard invitation could not be sent. Use the team member menu to retry.",
      );
    }

    return;
  }

  toast.success("Team member added with existing dashboard access.");
}
