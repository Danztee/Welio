import { workspaceInvitationInspect } from "@/lib/backend/generated/sdk.gen";
import { currentUser } from "@/lib/auth/session";
import { AuthShell } from "@/components/auth/auth-shell";
import { InviteContent } from "@/components/workspace/invite-content";
import { backendClient, BackendError } from "@/lib/backend/server-api";

export const metadata = {
  title: "Join workspace",
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: PageProps<"/accept-invite">) {
  const p = await searchParams;
  const token =
    typeof p.token === "string" && /^[A-Za-z0-9_-]{40,100}$/.test(p.token)
      ? p.token
      : "";
  const user = await currentUser();
  let name = "",
    error = "";
  if (user?.emailVerified && token)
    try {
      const result = await workspaceInvitationInspect({
        client: await backendClient(),
        throwOnError: true,
        body: { token },
      });
      name = result.data.workspace_name;
    } catch (e) {
      if (e instanceof BackendError) error = e.message;
      else throw e;
    }

  return (
    <AuthShell>
      <div className="flex flex-col gap-6">
        <h1 className="text-[1.75rem] font-medium">Join your team</h1>
        <InviteContent token={token} user={user} name={name} error={error} />
      </div>
    </AuthShell>
  );
}
