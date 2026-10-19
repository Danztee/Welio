import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import {
  getWorkspaceDashboard,
  listWorkspaces,
} from "@/features/workspaces/queries";
import { BackendError } from "@/lib/backend/server-api";
import { WorkspaceOnboarding } from "@/components/workspace/onboarding";

export const metadata = {
  title: "Set up your workspace",
  robots: { index: false, follow: false },
};

export default async function Page({ searchParams }: PageProps<"/onboarding">) {
  const params = await searchParams;
  const user = await requireUser(
    "/onboarding" +
      (params.new === "true"
        ? "?new=true"
        : typeof params.workspace === "string"
          ? `?workspace=${encodeURIComponent(params.workspace)}`
          : ""),
  );
  const list = await listWorkspaces();
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
    data = await getWorkspaceDashboard(selected);
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) notFound();

    throw error;
  }

  if (data.role !== "owner" || data.workspace.onboarded)
    redirect(`/dashboard?workspace=${selected}`);

  return <WorkspaceOnboarding key={selected} user={user} data={data} />;
}
