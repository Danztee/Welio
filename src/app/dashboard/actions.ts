"use server";
import { revalidatePath } from "next/cache";
import { getDatabase } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { sendMail } from "@/lib/auth/email";
import * as repo from "@/lib/workspaces/repository";
import { z } from "zod";
export async function workspaceAction(
  action: string,
  workspaceId: string,
  input: unknown,
) {
  const user = await requireUser();
  try {
    const db = getDatabase();
    if (action !== "create") z.uuid().parse(workspaceId);
    let id = workspaceId;
    switch (action) {
      case "create":
        id = await repo.createWorkspace(db, user.id, input);
        break;
      case "business":
        await repo.saveBusiness(db, user.id, id, input);
        break;
      case "service":
        await repo.saveService(db, user.id, id, input);
        break;
      case "assignServiceStaff":
        await repo.saveServiceStaff(db, user.id, id, input);
        break;
      case "staff":
        await repo.saveStaff(db, user.id, id, input);
        break;
      case "finish":
        await repo.finishSetup(db, user.id, id);
        break;
      case "invite": {
        const email = z.email().max(254).parse(input).toLowerCase();
        const invite = await repo.inviteMember(db, user.id, id, email);
        try {
          await sendMail({
            to: email,
            subject: `Join ${invite.name} on Welio`,
            text: `You’ve been invited to join ${invite.name} as a staff member. Sign in or create an account with this email, then accept your invitation:\n\n${process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000"}/accept-invite?token=${invite.token}\n\nThis invitation expires in 7 days.`,
          });
        } catch {
          await repo.revokeAccess(db, user.id, id, invite.id, "invitation");
          throw new repo.WorkspaceError(
            "The invitation email could not be delivered. Check email configuration and try again.",
          );
        }
        break;
      }
      case "revoke": {
        const v = z
          .object({ target: z.uuid(), kind: z.enum(["member", "invitation"]) })
          .parse(input);
        await repo.revokeAccess(db, user.id, id, v.target, v.kind);
        break;
      }
      default:
        throw new repo.WorkspaceError("Unknown workspace action.");
    }
    revalidatePath("/dashboard", "layout");
    revalidatePath("/onboarding");
    return { ok: true as const, id };
  } catch (error) {
    if (error instanceof z.ZodError)
      return {
        ok: false as const,
        error: error.issues[0]?.message ?? "Check the form fields.",
      };
    if (error instanceof repo.WorkspaceError)
      return { ok: false as const, error: error.message };
    const cause = error instanceof Error ? error.cause : undefined;
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "23505"
    )
      return {
        ok: false as const,
        error: "That booking address is already taken. Choose another.",
      };
    console.error(
      JSON.stringify({ event: "workspace_operation_failed", action }),
    );
    return {
      ok: false as const,
      error: "Could not save this change. Please try again.",
    };
  }
}
export async function acceptInviteAction(token: string) {
  const user = await requireUser();
  try {
    z.string().min(40).max(100).parse(token);
    const id = await repo.acceptInvitation(
      getDatabase(),
      user.id,
      user.email,
      token,
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
