"use server";

import { revalidatePath } from "next/cache";
import {
  serviceInput,
  serviceStaffInput,
  staffInput,
  workspaceInput,
} from "@/lib/domain/workspaces/contract";
import { requireUser } from "@/lib/auth/session";
import { backendClient, BackendError } from "@/lib/backend/server-api";
import { z } from "zod";

import {
  workspacesCreate,
  workspaceUpdate,
  catalogServiceCreate,
  catalogServiceUpdate,
  catalogServiceAssignStaff,
  catalogStaffCreate,
  catalogStaffUpdate,
  workspaceFinishSetup,
  workspaceInvitationCreate,
  workspaceInvitationRevoke,
  workspaceMemberRevoke,
  workspaceInvitationAccept,
} from "@/lib/backend/generated/sdk.gen";
import type { WorkspaceInput } from "@/lib/domain/workspaces/contract";

function workspaceBody(workspace: WorkspaceInput) {
  return {
    name: workspace.name,
    logo: workspace.logo,
    slug: workspace.slug,
    contact_email: workspace.contactEmail,
    phone: workspace.phone,
    service_area: workspace.serviceArea,
    business_address: workspace.businessAddress,
    booking_location: workspace.bookingLocation,
    time_zone: workspace.timeZone,
    currency: workspace.currency,
  };
}

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
    const result = await workspacesCreate({
      client: await backendClient(),
      throwOnError: true,
      body: workspaceBody(workspace),
    });

    return result.data.id;
  });
}

export async function saveBusinessAction(workspaceId: string, input: unknown) {
  return completeWorkspaceMutation("business", async () => {
    const id = z.uuid().parse(workspaceId);
    const workspace = workspaceInput.parse(input);
    await workspaceUpdate({
      client: await backendClient(id),
      throwOnError: true,
      path: { workspaceID: id },
      body: workspaceBody(workspace),
    });

    return id;
  });
}

export async function saveServiceAction(workspaceId: string, input: unknown) {
  return completeWorkspaceMutation("service", async () => {
    const id = z.uuid().parse(workspaceId);
    const service = serviceInput.parse(input);
    const body = {
      name: service.name,
      description: service.description,
      duration_minutes: service.durationMinutes,
      price: service.price,
      buffer_before_minutes: service.bufferBeforeMinutes,
      buffer_after_minutes: service.bufferAfterMinutes,
      is_active: service.isActive,
      staff_ids: service.staffIds,
    };
    const client = await backendClient(id);
    const result = service.id
      ? await catalogServiceUpdate({
          client,
          throwOnError: true,
          path: { serviceID: service.id },
          body,
        })
      : await catalogServiceCreate({ client, throwOnError: true, body });

    return result.data.id;
  });
}

export async function assignServiceStaffAction(
  workspaceId: string,
  input: unknown,
) {
  return completeWorkspaceMutation("assignServiceStaff", async () => {
    const id = z.uuid().parse(workspaceId);
    const assignment = serviceStaffInput.parse(input);
    await catalogServiceAssignStaff({
      client: await backendClient(id),
      throwOnError: true,
      path: { serviceID: assignment.serviceId },
      body: { staff_ids: assignment.staffIds },
    });

    return id;
  });
}

export async function saveStaffAction(workspaceId: string, input: unknown) {
  return completeWorkspaceMutation("staff", async () => {
    const id = z.uuid().parse(workspaceId);
    const staff = staffInput.parse(input);
    const body = {
      name: staff.name,
      email: staff.email,
      job_title: staff.jobTitle,
      is_active: staff.isActive,
      schedule: {
        start: staff.schedule.start,
        end: staff.schedule.end,
        days: staff.schedule.days,
        break_start: staff.schedule.breakStart,
        break_end: staff.schedule.breakEnd,
      },
    };
    const client = await backendClient(id);
    const result = staff.id
      ? await catalogStaffUpdate({
          client,
          throwOnError: true,
          path: { staffID: staff.id },
          body,
        })
      : await catalogStaffCreate({ client, throwOnError: true, body });

    return result.data.id;
  });
}

export async function finishWorkspaceSetupAction(workspaceId: string) {
  return completeWorkspaceMutation("finish", async () => {
    const id = z.uuid().parse(workspaceId);
    await workspaceFinishSetup({
      client: await backendClient(id),
      throwOnError: true,
      path: { workspaceID: id },
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
    const result = await workspaceInvitationCreate({
      client: await backendClient(id),
      throwOnError: true,
      path: { workspaceID: id },
      body: { email },
    });

    return result.data.id;
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
    const client = await backendClient(id);
    if (target.kind === "member") {
      await workspaceMemberRevoke({
        client,
        throwOnError: true,
        path: { workspaceID: id, userID: target.target },
      });
    } else {
      await workspaceInvitationRevoke({
        client,
        throwOnError: true,
        path: { workspaceID: id, invitationID: target.target },
      });
    }

    return id;
  });
}

export async function acceptInviteAction(token: string) {
  await requireUser();
  try {
    const invitationToken = z.string().min(40).max(100).parse(token);
    const result = await workspaceInvitationAccept({
      client: await backendClient(),
      throwOnError: true,
      body: { token: invitationToken },
    });
    revalidatePath("/dashboard", "layout");

    return { ok: true as const, id: result.data.workspace_id };
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
