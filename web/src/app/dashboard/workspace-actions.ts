"use server";

import { revalidatePath } from "next/cache";
import {
  serviceInput,
  serviceStaffInput,
  staffInput,
  workspaceInput,
} from "@/lib/domain/workspaces/contract";
import { requireUser } from "@/lib/auth/session";
import { backendRequest, BackendError } from "@/lib/backend/server-api";
import { z } from "zod";

type ActionResult = { ok: true; id: string } | { ok: false; error: string };

async function completeWorkspaceMutation(
  action: string,
  operation: () => Promise<string>,
): Promise<ActionResult> {
  await requireUser();
  try {
    const id = await operation();
    revalidatePath("/dashboard", "layout");
    revalidatePath("/onboarding");

    return { ok: true, id };
  } catch (error) {
    if (error instanceof z.ZodError)
      return {
        ok: false,
        error: error.issues[0]?.message ?? "Check the form fields.",
      };

    if (error instanceof BackendError)
      return { ok: false, error: error.message };

    console.error(
      JSON.stringify({ event: "workspace_operation_failed", action }),
    );

    return {
      ok: false,
      error: "Could not save this change. Please try again.",
    };
  }
}

export async function createWorkspaceAction(input: unknown) {
  return completeWorkspaceMutation("create", async () => {
    const workspace = workspaceInput.parse(input);
    const result = await backendRequest<{ id: string }>("/v1/workspaces", {
      method: "POST",
      body: workspace,
    });

    return result.id;
  });
}

export async function saveBusinessAction(workspaceId: string, input: unknown) {
  return completeWorkspaceMutation("business", async () => {
    const id = z.uuid().parse(workspaceId);
    const workspace = workspaceInput.parse(input);
    await backendRequest<void>(`/v1/workspaces/${id}`, {
      method: "PUT",
      workspaceId: id,
      body: workspace,
    });

    return id;
  });
}

export async function saveServiceAction(workspaceId: string, input: unknown) {
  return completeWorkspaceMutation("service", async () => {
    const id = z.uuid().parse(workspaceId);
    const service = serviceInput.parse(input);
    const { id: serviceId, ...body } = service;
    const result = serviceId
      ? await backendRequest<{ id: string }>(
          `/v1/catalog/services/${serviceId}`,
          { method: "PUT", workspaceId: id, body },
        )
      : await backendRequest<{ id: string }>("/v1/catalog/services", {
          method: "POST",
          workspaceId: id,
          body,
        });

    return result.id;
  });
}

export async function assignServiceStaffAction(
  workspaceId: string,
  input: unknown,
) {
  return completeWorkspaceMutation("assignServiceStaff", async () => {
    const id = z.uuid().parse(workspaceId);
    const assignment = serviceStaffInput.parse(input);
    await backendRequest<void>(
      `/v1/catalog/services/${assignment.serviceId}/staff`,
      {
        method: "PUT",
        workspaceId: id,
        body: { staffIds: assignment.staffIds },
      },
    );

    return id;
  });
}

export async function saveStaffAction(workspaceId: string, input: unknown) {
  return completeWorkspaceMutation("staff", async () => {
    const id = z.uuid().parse(workspaceId);
    const staff = staffInput.parse(input);
    const { id: staffId, ...body } = staff;
    const result = staffId
      ? await backendRequest<{ id: string }>(`/v1/catalog/staff/${staffId}`, {
          method: "PUT",
          workspaceId: id,
          body,
        })
      : await backendRequest<{ id: string }>("/v1/catalog/staff", {
          method: "POST",
          workspaceId: id,
          body,
        });

    return result.id;
  });
}

export async function finishWorkspaceSetupAction(workspaceId: string) {
  return completeWorkspaceMutation("finish", async () => {
    const id = z.uuid().parse(workspaceId);
    await backendRequest<void>(`/v1/workspaces/${id}/setup/complete`, {
      method: "POST",
      workspaceId: id,
      body: {},
    });

    return id;
  });
}

export async function inviteWorkspaceMemberAction(
  workspaceId: string,
  input: unknown,
) {
  return completeWorkspaceMutation("invite", async () => {
    const id = z.uuid().parse(workspaceId);
    const email = z.email().max(254).parse(input).toLowerCase();
    const result = await backendRequest<{ id: string }>(
      `/v1/workspaces/${id}/invitations`,
      { method: "POST", workspaceId: id, body: { email } },
    );

    return result.id;
  });
}

export async function revokeWorkspaceAccessAction(
  workspaceId: string,
  input: unknown,
) {
  return completeWorkspaceMutation("revoke", async () => {
    const id = z.uuid().parse(workspaceId);
    const target = z
      .object({ target: z.uuid(), kind: z.enum(["member", "invitation"]) })
      .parse(input);
    const collection = target.kind === "member" ? "members" : "invitations";
    await backendRequest<void>(
      `/v1/workspaces/${id}/${collection}/${target.target}`,
      { method: "DELETE", workspaceId: id },
    );

    return id;
  });
}

export async function acceptInviteAction(token: string) {
  await requireUser();
  try {
    const invitationToken = z.string().min(40).max(100).parse(token);
    const result = await backendRequest<{ workspaceId: string }>(
      "/v1/invitations/accept",
      { method: "POST", body: { token: invitationToken } },
    );
    revalidatePath("/dashboard", "layout");

    return { ok: true as const, id: result.workspaceId };
  } catch (error) {
    if (error instanceof z.ZodError)
      return { ok: false as const, error: "This invitation is unavailable." };

    if (error instanceof BackendError)
      return { ok: false as const, error: error.message };

    return {
      ok: false as const,
      error:
        "This invitation is unavailable. Sign in with the invited email or ask for a new invitation.",
    };
  }
}
