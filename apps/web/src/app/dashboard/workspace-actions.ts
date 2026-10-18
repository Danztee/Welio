"use server";

import { Buffer } from "node:buffer";
import { revalidatePath } from "next/cache";
import { getDatabase } from "@welio/db";
import * as repository from "@welio/db/workspaces";
import {
  serviceInput,
  serviceStaffInput,
  staffInput,
  workspaceInput,
} from "@welio/domain/workspaces/contract";
import { WorkspaceError } from "@welio/domain/workspaces/errors";
import { requireUser } from "@/lib/auth/session";
import { sendMail } from "@/lib/auth/email";
import { z } from "zod";

type ActionResult = { ok: true; id: string } | { ok: false; error: string };

function validateWorkspaceLogo(logo: string | null) {
  if (!logo) return;

  const encoded = logo.slice("data:image/webp;base64,".length);
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.length > 450 * 1024 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  )
    throw new WorkspaceError("Choose a valid image smaller than 450 KB.");
}

async function completeWorkspaceMutation(
  action: string,
  operation: (userId: string) => Promise<string>,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const id = await operation(user.id);
    revalidatePath("/dashboard", "layout");
    revalidatePath("/onboarding");

    return { ok: true, id };
  } catch (error) {
    if (error instanceof z.ZodError)
      return {
        ok: false,
        error: error.issues[0]?.message ?? "Check the form fields.",
      };

    if (error instanceof WorkspaceError)
      return { ok: false, error: error.message };

    const cause = error instanceof Error ? error.cause : undefined;
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "23505"
    )
      return {
        ok: false,
        error: "That booking address is already taken. Choose another.",
      };

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
  return completeWorkspaceMutation("create", async (userId) => {
    const workspace = workspaceInput.parse(input);
    validateWorkspaceLogo(workspace.logo);

    return repository.createWorkspace(getDatabase(), userId, workspace);
  });
}

export async function saveBusinessAction(workspaceId: string, input: unknown) {
  return completeWorkspaceMutation("business", async (userId) => {
    const id = z.uuid().parse(workspaceId);
    const workspace = workspaceInput.parse(input);
    validateWorkspaceLogo(workspace.logo);
    await repository.saveBusiness(getDatabase(), userId, id, workspace);

    return id;
  });
}

export async function saveServiceAction(workspaceId: string, input: unknown) {
  return completeWorkspaceMutation("service", async (userId) => {
    const id = z.uuid().parse(workspaceId);
    await repository.saveService(
      getDatabase(),
      userId,
      id,
      serviceInput.parse(input),
    );

    return id;
  });
}

export async function assignServiceStaffAction(
  workspaceId: string,
  input: unknown,
) {
  return completeWorkspaceMutation("assignServiceStaff", async (userId) => {
    const id = z.uuid().parse(workspaceId);
    await repository.saveServiceStaff(
      getDatabase(),
      userId,
      id,
      serviceStaffInput.parse(input),
    );

    return id;
  });
}

export async function saveStaffAction(workspaceId: string, input: unknown) {
  return completeWorkspaceMutation("staff", async (userId) => {
    const id = z.uuid().parse(workspaceId);
    await repository.saveStaff(
      getDatabase(),
      userId,
      id,
      staffInput.parse(input),
    );

    return id;
  });
}

export async function finishWorkspaceSetupAction(workspaceId: string) {
  return completeWorkspaceMutation("finish", async (userId) => {
    const id = z.uuid().parse(workspaceId);
    await repository.finishSetup(getDatabase(), userId, id);

    return id;
  });
}

export async function inviteWorkspaceMemberAction(
  workspaceId: string,
  input: unknown,
) {
  return completeWorkspaceMutation("invite", async (userId) => {
    const id = z.uuid().parse(workspaceId);
    const email = z.email().max(254).parse(input).toLowerCase();
    const invitation = await repository.inviteMember(
      getDatabase(),
      userId,
      id,
      email,
    );
    try {
      await sendMail({
        to: email,
        subject: `Join ${invitation.name} on Welio`,
        text: `You’ve been invited to join ${invitation.name} as a staff member. Sign in or create an account with this email, then accept your invitation:\n\n${process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000"}/accept-invite?token=${invitation.token}\n\nThis invitation expires in 7 days.`,
      });
    } catch {
      await repository.revokeAccess(
        getDatabase(),
        userId,
        id,
        invitation.id,
        "invitation",
      );
      throw new WorkspaceError(
        "The invitation email could not be delivered. Check email configuration and try again.",
      );
    }

    return id;
  });
}

export async function revokeWorkspaceAccessAction(
  workspaceId: string,
  input: unknown,
) {
  return completeWorkspaceMutation("revoke", async (userId) => {
    const id = z.uuid().parse(workspaceId);
    const target = z
      .object({ target: z.uuid(), kind: z.enum(["member", "invitation"]) })
      .parse(input);
    await repository.revokeAccess(
      getDatabase(),
      userId,
      id,
      target.target,
      target.kind,
    );

    return id;
  });
}

export async function acceptInviteAction(token: string) {
  const user = await requireUser();
  try {
    const invitationToken = z.string().min(40).max(100).parse(token);
    const id = await repository.acceptInvitation(
      getDatabase(),
      user.id,
      user.email,
      invitationToken,
    );
    revalidatePath("/dashboard", "layout");

    return { ok: true as const, id };
  } catch {
    return {
      ok: false as const,
      error:
        "This invitation is unavailable. Sign in with the invited email or ask for a new invitation.",
    };
  }
}
