import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getDatabase } from "@/db";
import { requireUser } from "@/lib/auth/session";
import {
  listWorkspaces,
  workspaceDetail,
  WorkspaceError,
} from "@/lib/workspaces/repository";
import { WorkspaceOnboarding } from "@/components/workspace/onboarding";
export const metadata = {
  title: "Set up your workspace",
  robots: { index: false, follow: false },
};
export default async function Page({ searchParams }: PageProps<"/onboarding">) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const list = await listWorkspaces(getDatabase(), user.id);
  const selected =
    typeof params.workspace === "string"
      ? params.workspace
      : params.new === "true"
        ? undefined
        : list.find((x) => x.role === "owner" && !x.workspace.onboarded)
            ?.workspace.id;
  if (!selected) {
    if (list.length && params.new !== "true") redirect("/dashboard");
    return <WorkspaceOnboarding key="new" user={user} data={null} />;
  }
  if (!z.uuid().safeParse(selected).success) notFound();
  let data;
  try {
    data = await workspaceDetail(getDatabase(), user.id, selected);
  } catch (error) {
    if (error instanceof WorkspaceError) notFound();
    throw error;
  }
  if (data.role !== "owner" || data.workspace.onboarded)
    redirect(`/dashboard?workspace=${selected}`);
  return <WorkspaceOnboarding key={selected} user={user} data={data} />;
}
